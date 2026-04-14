import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../core/config.js';
import { loadTestSuite, saveResult, formatElapsed } from '../core/suite-io.js';
import { SandboxClient } from '../sandbox/opensandbox.js';
import { fetchAndCacheDocs } from '../sandbox/docs-fetcher.js';
import { scaffoldWorkspace } from '../sandbox/scaffolding.js';
import { WorkerPool } from '../sandbox/worker-pool.js';
import { createAdapter } from '../agents/adapter.js';
import type { ProjectPaths } from '../core/paths.js';
import type { Config, TestCase, SolutionFile, TargetConfig } from '../core/types.js';

function resolveEnv(
  env: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!env) return undefined;

  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value.startsWith('$')) {
      const hostVar = value.slice(1);
      const hostValue = process.env[hostVar];
      if (hostValue === undefined) {
        throw new Error(
          `Environment variable '${hostVar}' referenced in workspace.env.${key} is not set on the host`,
        );
      }
      resolved[key] = hostValue;
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

function interpolateSystemPrompt(
  template: string,
  config: Config,
): string {
  const packageName = config.publicInfo?.packageName ?? 'the SDK';
  const docsUrl = config.publicInfo?.docsUrl ?? '';
  return template
    .replace(/\{\{packageName\}\}/g, packageName)
    .replace(/\{\{docsUrl\}\}/g, docsUrl);
}

function buildAgentPrompt(
  testCase: TestCase,
  config: Config,
): string {
  const systemPrompt = config.sandbox?.systemPrompt
    ? interpolateSystemPrompt(config.sandbox.systemPrompt, config)
    : '';

  const prefix = systemPrompt ? `${systemPrompt}\n\n` : '';

  return `${prefix}Read the problem statement in /workspace/PROBLEM.md and the SDK documentation in /workspace/DOCS.md.

Implement the solution and write all output files to the /workspace/solution/ directory.

Make sure to create the /workspace/solution/ directory first if it does not exist.`;
}


async function extractSolution(
  client: SandboxClient,
): Promise<SolutionFile[]> {
  let files: string[];
  try {
    files = await client.listFiles('/workspace/solution');
  } catch {
    return [];
  }

  if (files.length === 0) {
    return [];
  }

  const solution: SolutionFile[] = [];
  for (const filePath of files) {
    try {
      const content = await client.readFile(filePath);
      solution.push({ path: filePath, content });
    } catch {
      // Skip files that can't be read (e.g. directories)
    }
  }
  return solution;
}

export async function executeTestCase(
  testCase: TestCase,
  target: TargetConfig,
  config: Config,
  docsContent: string,
  paths: ProjectPaths,
): Promise<void> {
  const client = new SandboxClient(config.sandbox);

  try {
    // Resolve env vars ($VAR → host value) and create sandbox
    const sandboxEnv = resolveEnv(config.workspace?.env);
    await client.create(
      target.image,
      sandboxEnv,
      target.timeout ?? config.sandbox.defaultTimeout,
    );

    // Scaffold workspace
    const setupLog = await scaffoldWorkspace(client, config, testCase);
    if (setupLog) {
      await saveResult(paths, testCase.id, 'setup.log', setupLog, target.name);
    }

    // Upload PROBLEM.md and DOCS.md
    await client.uploadFiles([
      { path: '/workspace/PROBLEM.md', data: testCase.problemStatement },
      { path: '/workspace/DOCS.md', data: docsContent },
    ]);

    // Create non-root user (agents like Claude refuse to run as root)
    await client.runCommand(
      'useradd -m -s /bin/bash sandbox 2>/dev/null; chown -R sandbox:sandbox /workspace'
    );

    // Install agent CLI inside the sandbox
    const executorConfig = config.agents?.executor ?? { command: 'claude' };
    const adapter = createAdapter(executorConfig);
    const installCmd = adapter.installCommand;
    if (installCmd) {
      await client.runCommand(installCmd);
    }

    // Run agent inside the sandbox
    const prompt = buildAgentPrompt(testCase, config);
    const agentCmd = adapter.sandboxCommand(prompt);
    const agentResult = await client.runCommandTimed(agentCmd);

    // Save agent output
    const agentLog = [
      `Exit code: ${agentResult.exitCode}`,
      `Duration: ${agentResult.durationMs}ms`,
      '',
      '=== STDOUT ===',
      agentResult.stdout,
      '',
      '=== STDERR ===',
      agentResult.stderr,
    ].join('\n');
    await saveResult(paths, testCase.id, 'agent-output.log', agentLog, target.name);

    // Extract solution
    const solution = await extractSolution(client);
    await saveResult(
      paths,
      testCase.id,
      'generated-solution.json',
      JSON.stringify(solution, null, 2),
      target.name,
    );
  } finally {
    await client.destroy();
  }
}

export async function executeCommand(paths: ProjectPaths, options: {
  freshDocs?: boolean;
} = {}): Promise<void> {
  const config = await loadConfig(paths.config);

  const spinner = ora('Loading test suite...').start();
  const testCases = await loadTestSuite(paths);
  spinner.succeed(`Loaded ${testCases.length} test case(s)`);

  // Validate connectivity
  spinner.start('Checking OpenSandbox connectivity...');
  await SandboxClient.checkConnectivity(config.sandbox);
  spinner.succeed('OpenSandbox server is reachable');

  // Fetch and cache docs
  spinner.start('Fetching SDK documentation...');
  const docsContent = config.publicInfo
    ? await fetchAndCacheDocs(config.publicInfo, { freshDocs: options.freshDocs, cacheDocs: paths.cacheDocs })
    : '';
  spinner.succeed('Documentation ready');

  const concurrency = config.sandbox.concurrency ?? 3;

  for (const target of config.targets) {
    console.log(chalk.bold(`\nTarget: ${target.name} (${target.image})`));
    console.log(chalk.dim(`Concurrency: ${concurrency}\n`));

    const startTime = Date.now();
    const pool = new WorkerPool(concurrency);

    const executeFn = async (tc: TestCase): Promise<void> => {
      try {
        await executeTestCase(tc, target, config, docsContent, paths);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await saveResult(paths, tc.id, 'error.log', message, target.name);
        throw err;
      }
    };

    const { passed, failed } = await pool.run(testCases, executeFn, (info, tc, event) => {
      const elapsed = formatElapsed(Date.now() - startTime);
      if (event === 'start') {
        console.log(chalk.dim(`[${info.completed + info.running}/${info.total}] ${tc.id} (${tc.difficulty}) — running... [${elapsed}]`));
      } else if (event === 'done') {
        console.log(chalk.green(`[${info.completed}/${info.total}] ${tc.id} (${tc.difficulty}) — done [${elapsed}]`));
      } else {
        console.log(chalk.red(`[${info.completed}/${info.total}] ${tc.id} (${tc.difficulty}) — failed [${elapsed}]`));
      }
    });

    console.log('');
    console.log(chalk.bold(`Execution Summary (${target.name})`));
    console.log(`  Total:  ${testCases.length}`);
    console.log(chalk.green(`  Passed: ${passed}`));
    if (failed > 0) {
      console.log(chalk.red(`  Failed: ${failed}`));
    }
    console.log(chalk.dim(`  Elapsed: ${formatElapsed(Date.now() - startTime)}`));
  }
}
