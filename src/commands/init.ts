import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import chalk from 'chalk';
import { ensureWorkingDir } from '../core/config.js';
import type { Config } from '../core/types.js';

const CONFIG_FILENAME = '.agentic-usability.json';

async function prompt(rl: ReturnType<typeof createInterface>, question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` ${chalk.dim(`(${defaultValue})`)}` : '';
  const answer = await rl.question(`${question}${suffix}: `);
  return answer.trim() || defaultValue || '';
}

async function promptRequired(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  let answer = '';
  while (!answer) {
    answer = await prompt(rl, question);
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

export async function initCommand(): Promise<void> {
  const configPath = join(process.cwd(), CONFIG_FILENAME);

  if (await pathExists(configPath)) {
    console.log(chalk.yellow(`Config file already exists: ${configPath}`));
    console.log(chalk.yellow('Delete it first if you want to re-initialize.'));
    return;
  }

  console.log(chalk.bold('\nAgentic Usability — Project Setup\n'));

  const rl = createInterface({ input: stdin, output: stdout });

  try {
    // Source configuration
    console.log(chalk.bold('Source Configuration'));
    const sourceType = await promptChoice(rl, 'Source type', ['local', 'git', 'url'], 'local') as 'local' | 'git' | 'url';

    const source: Config['source'] = { type: sourceType };

    if (sourceType === 'local') {
      const rawPath = await promptRequired(rl, 'Path to SDK source');
      const absPath = resolve(rawPath);
      if (!(await pathExists(absPath))) {
        console.log(chalk.red(`Directory not found: ${absPath}`));
        rl.close();
        process.exit(1);
      }
      source.path = rawPath;
    } else if (sourceType === 'git') {
      source.url = await promptRequired(rl, 'Git repository URL');
      const branch = await prompt(rl, 'Branch', 'main');
      if (branch) source.branch = branch;
      const subpath = await prompt(rl, 'Subpath within repo (optional)');
      if (subpath) source.subpath = subpath;
    } else {
      const urlsRaw = await promptRequired(rl, 'Documentation URLs (comma-separated)');
      source.urls = urlsRaw.split(',').map(u => u.trim()).filter(Boolean);
    }

    // Public info
    console.log(chalk.bold('\nPublic Information'));
    const docsUrl = await prompt(rl, 'Documentation URL (optional)');
    const packageName = await prompt(rl, 'Package name (optional)');
    const installCommand = await prompt(rl, 'Install command (optional)');

    const publicInfo: Config['publicInfo'] = {};
    if (docsUrl) publicInfo.docsUrl = docsUrl;
    if (packageName) publicInfo.packageName = packageName;
    if (installCommand) publicInfo.installCommand = installCommand;

    // Agent configuration
    console.log(chalk.bold('\nAgent Configuration'));
    const agentCommand = await prompt(rl, 'Agent command', 'claude');

    // Target configuration
    console.log(chalk.bold('\nTarget Configuration'));
    const targets: Config['targets'] = [];
    let addMore = true;
    while (addMore) {
      const name = await promptRequired(rl, 'Target name');
      const image = await promptRequired(rl, 'Docker image for target');
      const timeoutStr = await prompt(rl, 'Timeout in seconds', '300');
      const timeout = parseInt(timeoutStr, 10) || 300;
      targets.push({ name, image, timeout });

      const more = await prompt(rl, 'Add another target?', 'no');
      addMore = more.toLowerCase().startsWith('y');
    }

    // Sandbox configuration
    console.log(chalk.bold('\nSandbox Configuration'));
    const domain = await prompt(rl, 'Sandbox domain', 'localhost:8080');

    rl.close();

    // Build config object
    const config: Config = {
      source,
      publicInfo: Object.keys(publicInfo).length > 0 ? publicInfo : undefined,
      agents: {
        generator: { command: agentCommand },
        executor: { command: agentCommand },
        judge: { command: agentCommand },
      },
      targets,
      sandbox: { domain },
    };

    // Write config file
    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    console.log(chalk.green(`\nConfig written to ${configPath}`));

    // Create working directory
    await ensureWorkingDir();
    console.log(chalk.green('Working directory created: .agentic-usability/'));
    console.log(chalk.dim('\nNext step: run `agentic-usability generate` to create a test suite.'));
  } catch (err) {
    rl.close();
    throw err;
  }
}
