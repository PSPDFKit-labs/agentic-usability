import chalk from 'chalk';
import ora from 'ora';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { loadConfig, ensureWorkingDir } from '../core/config.js';
import { createAdapter } from '../agents/adapter.js';
import { SandboxClient } from '../sandbox/opensandbox.js';
import { fetchAndCacheDocs } from '../sandbox/docs-fetcher.js';
import { scaffoldWorkspace } from '../sandbox/scaffolding.js';
import type { Config, TestCase, SolutionFile } from '../core/types.js';

const DEFAULT_SUITE_FILE = '.agentic-usability/suite.json';
const RESULTS_DIR = '.agentic-usability/results';

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

async function loadTestSuite(config: Config): Promise<TestCase[]> {
  const suiteFile = resolve(config.output?.suiteFile ?? DEFAULT_SUITE_FILE);
  let raw: string;
  try {
    raw = await readFile(suiteFile, 'utf-8');
  } catch {
    throw new Error(
      `Test suite not found at ${suiteFile}. Run 'agentic-usability generate' first.`,
    );
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Test suite at ${suiteFile} is not a JSON array`);
  }
  return parsed as TestCase[];
}

async function saveResult(
  testId: string,
  filename: string,
  content: string,
): Promise<void> {
  const dir = resolve(join(RESULTS_DIR, testId));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), content, 'utf-8');
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

async function executeTestCase(
  testCase: TestCase,
  target: { name: string; image: string; timeout?: number },
  config: Config,
  docsContent: string,
): Promise<void> {
  const client = new SandboxClient(config.sandbox);

  try {
    // Create sandbox
    await client.create(
      target.image,
      config.workspace?.env,
      target.timeout ?? config.sandbox.defaultTimeout,
    );

    // Scaffold workspace
    const setupLog = await scaffoldWorkspace(client, config, testCase);
    if (setupLog) {
      await saveResult(testCase.id, 'setup.log', setupLog);
    }

    // Upload PROBLEM.md and DOCS.md
    await client.uploadFiles([
      { path: '/workspace/PROBLEM.md', data: testCase.problemStatement },
      { path: '/workspace/DOCS.md', data: docsContent },
    ]);

    // Install agent CLI
    const executorConfig = config.agents?.executor ?? { command: 'claude' };
    const installCmd = getAgentInstallCommand(executorConfig.command);
    if (installCmd) {
      await client.runCommand(installCmd);
    }

    // Run agent
    const adapter = createAdapter(executorConfig);
    const prompt = buildAgentPrompt(testCase, config);
    const agentResult = await adapter.execute(prompt, '/workspace', config.workspace?.env);

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
    await saveResult(testCase.id, 'agent-output.log', agentLog);

    // Extract solution
    const solution = await extractSolution(client);
    await saveResult(
      testCase.id,
      'generated-solution.json',
      JSON.stringify(solution, null, 2),
    );
  } finally {
    await client.destroy();
  }
}

function getAgentInstallCommand(command: string): string | null {
  switch (command) {
    case 'claude':
      return 'npm i -g @anthropic-ai/claude-code';
    case 'codex':
      return 'npm i -g @openai/codex';
    case 'gemini':
      return 'npm i -g @google/gemini-cli';
    default:
      return null;
  }
}

export async function executeCommand(options: {
  freshDocs?: boolean;
} = {}): Promise<void> {
  const config = await loadConfig();
  await ensureWorkingDir();

  const spinner = ora('Loading test suite...').start();
  const testCases = await loadTestSuite(config);
  spinner.succeed(`Loaded ${testCases.length} test case(s)`);

  // Validate connectivity
  spinner.start('Checking OpenSandbox connectivity...');
  await SandboxClient.checkConnectivity(config.sandbox);
  spinner.succeed('OpenSandbox server is reachable');

  // Fetch and cache docs
  spinner.start('Fetching SDK documentation...');
  const docsContent = config.publicInfo
    ? await fetchAndCacheDocs(config.publicInfo, { freshDocs: options.freshDocs })
    : '';
  spinner.succeed('Documentation ready');

  // Use the first target (sequential execution per US-014 — concurrency in US-015)
  const target = config.targets[0];
  console.log(chalk.bold(`\nTarget: ${target.name} (${target.image})`));

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    const label = `[${i + 1}/${testCases.length}] ${tc.id} (${tc.difficulty})`;

    spinner.start(`${label} — running...`);
    try {
      await executeTestCase(tc, target, config, docsContent);
      spinner.succeed(`${label} — done`);
      passed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      spinner.fail(`${label} — failed: ${message}`);
      await saveResult(tc.id, 'error.log', message);
      failed++;
    }
  }

  console.log('');
  console.log(chalk.bold('Execution Summary'));
  console.log(`  Total:  ${testCases.length}`);
  console.log(chalk.green(`  Passed: ${passed}`));
  if (failed > 0) {
    console.log(chalk.red(`  Failed: ${failed}`));
  }
  console.log(`  Results saved to ${resolve(RESULTS_DIR)}`);
}
