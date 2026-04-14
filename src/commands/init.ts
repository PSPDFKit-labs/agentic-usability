import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { ensureProjectDirs, type ProjectPaths } from '../core/paths.js';
import type { Config } from '../core/types.js';

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

    const source: Config['source'] = { type: sourceType };

    if (sourceType === 'local') {
      hint("Absolute or relative path to your SDK's source code directory");
      const rawPath = await promptRequired(rl, 'Path to SDK source');
      const absPath = resolve(rawPath);
      if (!(await pathExists(absPath))) {
        console.log(chalk.red(`Directory not found: ${absPath}`));
        rl.close();
        process.exit(1);
      }
      source.path = rawPath;

      hint("Scope to a subdirectory, e.g. 'packages/core' in a monorepo");
      const subpath = await prompt(rl, 'Subpath within source (optional)');
      if (subpath) source.subpath = subpath;
    } else if (sourceType === 'git') {
      source.url = await promptRequired(rl, 'Git repository URL');
      const branch = await prompt(rl, 'Branch', 'main');
      if (branch) source.branch = branch;

      hint("Scope to a subdirectory, e.g. 'packages/core' in a monorepo");
      const subpath = await prompt(rl, 'Subpath within repo (optional)');
      if (subpath) source.subpath = subpath;
    } else {
      hint("Comma-separated URLs to fetch as documentation for agents");
      const urlsRaw = await promptRequired(rl, 'Documentation URLs');
      source.urls = urlsRaw.split(',').map(u => u.trim()).filter(Boolean);
    }

    hint("Extra guidance for the test generator (e.g. 'Focus on the Builder API, ignore legacy v1')");
    const additionalContext = await prompt(rl, 'Additional context for test generation (optional)');
    if (additionalContext) source.additionalContext = additionalContext;

    // ── Public information ────────────────────────────────────────────
    console.log(chalk.bold('\n2. Public SDK Information'));
    hint("These are injected into sandboxes so agents can find and install your SDK.\n");

    hint("Public documentation URL — fetched and provided to agents as DOCS.md");
    const docsUrl = await prompt(rl, 'Documentation URL');

    hint("The package name agents will import (e.g. @example/sdk, my-sdk)");
    const packageName = await prompt(rl, 'Package name');

    hint("Shell command to install the SDK inside a sandbox (e.g. npm install @example/sdk)");
    const installCommand = await prompt(rl, 'Install command');

    const publicInfo: Config['publicInfo'] = {};
    if (docsUrl) publicInfo.docsUrl = docsUrl;
    if (packageName) publicInfo.packageName = packageName;
    if (installCommand) publicInfo.installCommand = installCommand;

    // ── Agent configuration ───────────────────────────────────────────
    console.log(chalk.bold('\n3. Agent Configuration'));
    hint("Which AI agent CLI to use for generation, execution, and judging.");
    hint("Supported: claude, codex, gemini, or any custom command.\n");

    const agentCommand = await prompt(rl, 'Agent command', 'claude');

    // ── Target configuration ──────────────────────────────────────────
    console.log(chalk.bold('\n4. Target Environment'));
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

    // ── Sandbox configuration ─────────────────────────────────────────
    console.log(chalk.bold('\n5. Sandbox Server'));
    hint("OpenSandbox server address. Start it with: opensandbox-server\n");

    const domain = await prompt(rl, 'Sandbox domain', 'localhost:8080');

    // ── Environment variables ─────────────────────────────────────────
    let workspaceEnv: Record<string, string> | undefined;

    console.log('');
    hint("Sandbox containers may need API keys or other env vars.");
    hint("Use $VAR_NAME to reference variables from your host environment.");
    const configureEnv = await prompt(rl, 'Configure sandbox environment variables?', 'no');

    if (configureEnv.toLowerCase().startsWith('y')) {
      workspaceEnv = {};
      console.log(chalk.dim('  Enter key=value pairs. Use $VAR to reference host env. Empty key to finish.\n'));

      while (true) {
        const pair = await prompt(rl, '  Variable (KEY=$VALUE or KEY=literal, empty to finish)');
        if (!pair) break;

        const eqIdx = pair.indexOf('=');
        if (eqIdx === -1) {
          console.log(chalk.yellow('  Invalid format. Use KEY=VALUE (e.g. ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY)'));
          continue;
        }

        const key = pair.slice(0, eqIdx).trim();
        const value = pair.slice(eqIdx + 1).trim();
        if (key) {
          workspaceEnv[key] = value;
          console.log(chalk.dim(`  Added: ${key}=${value.startsWith('$') ? chalk.cyan(value) : value}`));
        }
      }

      if (Object.keys(workspaceEnv).length === 0) {
        workspaceEnv = undefined;
      }
    }

    // ── Build config ──────────────────────────────────────────────────
    const config: Config = {
      source,
      publicInfo: Object.keys(publicInfo).length > 0 ? publicInfo : undefined,
      agents: {
        generator: { command: agentCommand },
        executor: { command: agentCommand },
        judge: { command: agentCommand },
      },
      targets,
      workspace: workspaceEnv ? { env: workspaceEnv } : undefined,
      sandbox: { domain },
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
    console.log(`  1. Ensure OpenSandbox is running:  ${chalk.cyan('opensandbox-server')}`);
    console.log(`  2. Generate test suite:            ${chalk.cyan('agentic-usability generate')}`);
    console.log(`  3. Run the full pipeline:          ${chalk.cyan('agentic-usability run')}`);
    console.log('');
  } catch (err) {
    rl.close();
    throw err;
  }
}
