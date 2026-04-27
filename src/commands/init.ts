import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { ensureProjectDirs } from '../core/paths.js';
import type { Config, ProjectPaths, SourceConfig, PackageSource } from '../types.js';

async function prompt(rl: ReturnType<typeof createInterface>, question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` ${chalk.dim(`(${defaultValue})`)}` : '';
  const answer = await rl.question(`${question}${suffix}: `);
  return answer.trim() || defaultValue || '';
}

async function promptRequired(rl: ReturnType<typeof createInterface>, question: string, defaultValue?: string): Promise<string> {
  let answer = '';
  while (!answer) {
    answer = await prompt(rl, question, defaultValue);
    if (!answer) {
      console.log(chalk.yellow('  This field is required.'));
    }
  }
  return answer;
}

async function promptChoice(rl: ReturnType<typeof createInterface>, question: string, choices: string[], defaultChoice?: string): Promise<string> {
  const choiceStr = choices.map(c => c === defaultChoice ? chalk.underline(c) : c).join('/');
  let answer = '';
  while (!answer) {
    answer = await prompt(rl, `${question} [${choiceStr}]`, defaultChoice);
    if (!choices.includes(answer)) {
      console.log(chalk.yellow(`  Must be one of: ${choices.join(', ')}`));
      answer = '';
    }
  }
  return answer;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function hint(text: string): void {
  console.log(chalk.dim(`  ${text}`));
}

export async function initCommand(paths: ProjectPaths): Promise<void> {
  const configPath = paths.config;

  if (await pathExists(configPath)) {
    console.log(chalk.yellow(`Config file already exists: ${configPath}`));
    console.log(chalk.yellow('Delete it first if you want to re-initialize.'));
    return;
  }

  console.log(chalk.bold('\nAgentic Usability — Project Setup\n'));

  const rl = createInterface({ input: stdin, output: stdout });

  try {
    // ── Source configuration ──────────────────────────────────────────
    console.log(chalk.bold('1. Source Configuration'));
    hint("Where does your SDK source code live?");
    hint("  local = a directory on this machine");
    hint("  git   = clone from a remote repository");
    hint("  url   = fetch documentation pages\n");

    const sourceType = await promptChoice(rl, 'Source type', ['local', 'git', 'url'], 'local') as 'local' | 'git' | 'url';

    hint("Extra guidance for the test generator (e.g. 'Focus on the Builder API, ignore legacy v1')");

    let source: SourceConfig;
    if (sourceType === 'local') {
      hint("Absolute or relative path to your SDK's source code directory");
      const rawPath = await promptRequired(rl, 'Path to SDK source');
      const absPath = resolve(rawPath);
      if (!(await pathExists(absPath))) {
        console.log(chalk.red(`Directory not found: ${absPath}`));
        rl.close();
        process.exit(1);
      }
      hint("Scope to a subdirectory, e.g. 'packages/core' in a monorepo");
      const subpath = await prompt(rl, 'Subpath within source (optional)');
      const additionalContext = await prompt(rl, 'Additional context for test generation (optional)');
      source = { type: 'local', path: rawPath, ...(subpath ? { subpath } : {}), ...(additionalContext ? { additionalContext } : {}) };
    } else if (sourceType === 'git') {
      const url = await promptRequired(rl, 'Git repository URL');
      const branch = await prompt(rl, 'Branch', 'main');
      hint("Scope to a subdirectory, e.g. 'packages/core' in a monorepo");
      const subpath = await prompt(rl, 'Subpath within repo (optional)');
      const additionalContext = await prompt(rl, 'Additional context for test generation (optional)');
      source = { type: 'git', url, ...(branch ? { branch } : {}), ...(subpath ? { subpath } : {}), ...(additionalContext ? { additionalContext } : {}) };
    } else {
      hint("URL to fetch as documentation source (add more sources by editing config.json)");
      const url = await promptRequired(rl, 'Documentation URL');
      const additionalContext = await prompt(rl, 'Additional context for test generation (optional)');
      source = { type: 'url', url, ...(additionalContext ? { additionalContext } : {}) };
    }

    // ── Public information ────────────────────────────────────────────
    console.log(chalk.bold('\n2. Public SDK Information'));
    hint("These are injected into sandboxes so agents can find and install your SDK.\n");

    hint("Public documentation URL — fetched and provided to agents as DOCS.md");
    const docsUrl = await prompt(rl, 'Documentation URL');

    hint("The package name agents will import (e.g. @example/sdk, my-sdk)");
    const packageName = await prompt(rl, 'Package name');

    hint("Shell command to install the SDK inside a sandbox (e.g. npm install @example/sdk)");
    const installCommand = await prompt(rl, 'Install command');

    hint("Extra context appended to sandbox docs (e.g. usage notes, common patterns)");
    const publicAdditionalContext = await prompt(rl, 'Additional context for sandbox agents (optional)');

    const publicInfoSources: Config['publicInfo'] = [];
    if (packageName) {
      const pkgSource: PackageSource = { type: 'package', name: packageName };
      if (installCommand) pkgSource.installCommand = installCommand;
      if (publicAdditionalContext) pkgSource.additionalContext = publicAdditionalContext;
      publicInfoSources.push(pkgSource);
    }
    if (docsUrl) {
      publicInfoSources.push({ type: 'url', url: docsUrl });
    }

    // ── Agent configuration ───────────────────────────────────────────
    console.log(chalk.bold('\n3. Agent Configuration'));
    hint("Which AI agent CLI to use for generation, execution, and judging.");
    hint("Supported: claude, codex, gemini, or any custom command.\n");

    const agentCommand = await prompt(rl, 'Agent command', 'claude');

    // ── Target configuration ──────────────────────────────────────────
    console.log(chalk.bold('\n5. Target Environment'));
    hint("Targets are Docker containers where agents solve problems.");
    hint("Each target runs independently — you can benchmark multiple runtimes.\n");

    const targets: Config['targets'] = [];
    let addMore = true;
    let targetIndex = 1;
    while (addMore) {
      if (targetIndex > 1) console.log('');
      hint("A label for this environment (used in result paths)");
      const name = await promptRequired(rl, 'Target name', 'node-20');

      hint("Docker image for the sandbox. Must be pre-pulled (docker pull <image>)");
      const image = await promptRequired(rl, 'Docker image', 'node:20-slim');

      hint("Max seconds per sandbox execution");
      const timeoutStr = await prompt(rl, 'Timeout in seconds', '300');
      const timeout = parseInt(timeoutStr, 10) || 300;
      targets.push({ name, image, timeout });

      const more = await prompt(rl, 'Add another target?', 'no');
      addMore = more.toLowerCase().startsWith('y');
      targetIndex++;
    }

    // ── Agent API secret ────────────────────────────────────────────────
    console.log(chalk.bold('\n4. Agent API Secret'));
    hint("The API key for your agent. Microsandbox injects it via TLS — the VM never sees the raw value.");
    hint("This is required for sandboxed execution (executor and judge).\n");

    const KNOWN_DEFAULTS: Record<string, { envVar: string; baseUrl: string }> = {
      claude: { envVar: 'ANTHROPIC_API_KEY', baseUrl: 'https://api.anthropic.com' },
      codex: { envVar: 'OPENAI_API_KEY', baseUrl: 'https://api.openai.com' },
      gemini: { envVar: 'GOOGLE_API_KEY', baseUrl: 'https://generativelanguage.googleapis.com' },
    };

    const knownDefaults = KNOWN_DEFAULTS[agentCommand];
    let agentSecret: { envVar?: string; value: string; baseUrl?: string };

    if (knownDefaults) {
      hint(`Detected known agent '${agentCommand}' — envVar and baseUrl auto-configured.`);
      const value = await prompt(rl, `Value for ${knownDefaults.envVar}`, `$${knownDefaults.envVar}`);
      agentSecret = { value };
    } else {
      const envVar = await promptRequired(rl, 'API key env var name');
      const value = await prompt(rl, `Value for ${envVar}`, `$${envVar}`);
      const baseUrl = await promptRequired(rl, 'API base URL');
      agentSecret = { envVar, value, baseUrl };
    }

    // ── Sandbox configuration ─────────────────────────────────────────
    console.log(chalk.bold('\n6. Sandbox Settings'));

    let sandboxSecrets: Record<string, { value: string; allowHosts: string[] }> | undefined;
    let sandboxEnv: Record<string, string> | undefined;

    // ── Additional secrets (non-agent) ────────────────────────────────
    console.log('');
    hint("Additional secrets beyond the agent API key (e.g. database credentials).");
    const configureSecrets = await prompt(rl, 'Configure additional sandbox secrets?', 'no');

    if (configureSecrets.toLowerCase().startsWith('y')) {
      sandboxSecrets = {};
      console.log(chalk.dim('  Enter secrets. Use $VAR to reference host env. Empty name to finish.\n'));

      while (true) {
        const name = await prompt(rl, '  Secret env var name (empty to finish)');
        if (!name) break;

        const value = await prompt(rl, `  Value for ${name}`, `$${name}`);
        const hosts = await prompt(rl, `  Allowed hosts (comma-separated)`);
        sandboxSecrets[name] = {
          value,
          allowHosts: hosts.split(',').map(h => h.trim()).filter(Boolean),
        };
        console.log(chalk.dim(`  Added secret: ${name}`));
      }

      if (Object.keys(sandboxSecrets).length === 0) {
        sandboxSecrets = undefined;
      }
    }

    // ── Plain environment variables ───────────────────────────────────
    console.log('');
    hint("Plain env vars are passed directly into the sandbox (e.g. license keys).");
    const configureEnv = await prompt(rl, 'Configure plain environment variables?', 'no');

    if (configureEnv.toLowerCase().startsWith('y')) {
      sandboxEnv = {};
      console.log(chalk.dim('  Enter key=value pairs. Use $VAR to reference host env. Empty key to finish.\n'));

      while (true) {
        const pair = await prompt(rl, '  Variable (KEY=$VALUE or KEY=literal, empty to finish)');
        if (!pair) break;

        const eqIdx = pair.indexOf('=');
        if (eqIdx === -1) {
          console.log(chalk.yellow('  Invalid format. Use KEY=VALUE'));
          continue;
        }

        const key = pair.slice(0, eqIdx).trim();
        const value = pair.slice(eqIdx + 1).trim();
        if (key) {
          sandboxEnv[key] = value;
          console.log(chalk.dim(`  Added: ${key}=${value.startsWith('$') ? chalk.cyan(value) : value}`));
        }
      }

      if (Object.keys(sandboxEnv).length === 0) {
        sandboxEnv = undefined;
      }
    }

    // ── Build config ──────────────────────────────────────────────────
    const config: Config = {
      privateInfo: [source],
      publicInfo: publicInfoSources.length > 0 ? publicInfoSources : undefined,
      agents: {
        generator: { command: agentCommand },
        executor: { command: agentCommand, secret: agentSecret },
        judge: { command: agentCommand, secret: agentSecret },
      },
      targets,
      sandbox: { secrets: sandboxSecrets, env: sandboxEnv },
    };

    // ── Summary ───────────────────────────────────────────────────────
    console.log(chalk.bold('\n── Config Summary ──\n'));
    console.log(JSON.stringify(config, null, 2));
    console.log('');

    const confirm = await prompt(rl, 'Write config?', 'yes');
    if (!confirm.toLowerCase().startsWith('y')) {
      console.log(chalk.yellow('Aborted. No files written.'));
      rl.close();
      return;
    }

    rl.close();

    // ── Write ─────────────────────────────────────────────────────────
    await ensureProjectDirs(paths);
    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

    console.log(chalk.green(`\nConfig written to ${configPath}`));
    console.log(chalk.green(`Project directory: ${paths.root}\n`));

    console.log(chalk.bold('Next steps:'));
    console.log(`  1. Generate test suite:  ${chalk.cyan('agentic-usability generate')}`);
    console.log(`  2. Run the full pipeline:  ${chalk.cyan('agentic-usability eval')}`);
    console.log('');
  } catch (err) {
    rl.close();
    throw err;
  }
}
