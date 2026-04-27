import chalk from 'chalk';
import ora from 'ora';
import { loadDotenv } from '../core/env.js';
import { loadConfig } from '../core/config.js';
import { loadTestSuite, saveResult, saveBinaryResult, formatElapsed } from '../core/suite-io.js';
import { MicrosandboxClient, buildSecrets, buildAgentSecret, resolveEnv } from '../sandbox/microsandbox.js';
import { createEgressLogger } from '../sandbox/egress-logger.js';
import { scaffoldWorkspace } from '../sandbox/scaffolding.js';
import { WorkerPool } from '../sandbox/worker-pool.js';
import { createAdapter } from '../agents/adapter.js';
import { getPackageSource, getUrlSources, getFileSources } from '../types.js';
import type { Config, TestCase, SolutionFile, TargetConfig, ProjectPaths, SandboxAgentConfig } from '../types.js';
import { uploadSources } from '../sandbox/scaffolding.js';

/**
 * Load .env and resolve sandbox secrets + env from config.
 * No connectivity check needed — microsandbox runs locally.
 */
export async function prepareSandbox(config: Config): Promise<void> {
  await loadDotenv();
  // Validate that referenced env vars exist by resolving them now
  buildSecrets(config.sandbox?.secrets);
  resolveEnv(config.sandbox?.env);
}

function interpolateSystemPrompt(
  template: string,
  config: Config,
): string {
  const pkg = getPackageSource(config.publicInfo ?? []);
  const packageName = pkg?.name ?? 'the SDK';
  const urls = getUrlSources(config.publicInfo ?? []);
  const docsUrl = urls[0]?.url ?? '';
  return template
    .replace(/\{\{packageName\}\}/g, packageName)
    .replace(/\{\{docsUrl\}\}/g, docsUrl);
}

function buildAgentPrompt(
  config: Config,
  sourceDirs?: string[],
): string {
  const executorConfig = config.agents?.executor;
  const systemPrompt = executorConfig?.systemPrompt
    ? interpolateSystemPrompt(executorConfig.systemPrompt, config)
    : '';

  const prefix = systemPrompt ? `${systemPrompt}\n\n` : '';

  const pkg = getPackageSource(config.publicInfo ?? []);
  const publicUrls = getUrlSources(config.publicInfo ?? []);

  const langInstruction = pkg?.language
    ? `\nIMPORTANT: Write your solution in ${pkg.language}.\n`
    : '';

  // Build docs context: URLs + lightweight hints
  const docsLines: string[] = [];
  if (pkg?.name) {
    docsLines.push(`Package: ${pkg.name}`);
  }
  if (pkg?.installCommand) {
    docsLines.push(`Install: ${pkg.installCommand}`);
  }
  for (const urlSource of publicUrls) {
    docsLines.push(`Documentation: ${urlSource.url}`);
  }
  if (sourceDirs && sourceDirs.length > 0) {
    docsLines.push(`Source files available at:\n${sourceDirs.map(d => `  - ${d}`).join('\n')}`);
  }
  if (pkg?.additionalContext) {
    docsLines.push(`\n${pkg.additionalContext}`);
  }

  const docsSection = docsLines.length > 0
    ? `\n## SDK Reference\n${docsLines.join('\n')}\n`
    : '';

  return `${prefix}Read the problem statement in /workspace/PROBLEM.md.
${docsSection}${langInstruction}
Implement the solution and write all output files to the /workspace/solution/ directory.
Prefix every solution file name with "solution__" (e.g. solution__main.py, solution__utils.py, solution__requirements.txt).
Only files with this prefix will be collected for evaluation.

Make sure to create the /workspace/solution/ directory first if it does not exist.

Throughout your work, maintain a file at /workspace/notes.md to record your progress.
Use it as a working log — note what you tried, what worked, what didn't, and any gotchas or surprises you encountered. Be candid: if something is confusing, broken, or you can't figure it out, say so plainly.

You are allowed to fail. A partial solution with honest notes about what went wrong is more valuable than a complete-looking solution that papers over problems. If you get stuck, document what you tried and why it didn't work, then move on to what you can solve.`;
}


/** Solution file prefix convention — only files with this basename prefix are collected. */
const SOLUTION_PREFIX = 'solution__';

async function extractSolution(
  client: MicrosandboxClient,
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
    const basename = filePath.split('/').pop() ?? '';
    if (!basename.startsWith(SOLUTION_PREFIX)) continue;
    try {
      const content = await client.readFile(filePath);
      // Skip binary files (content with null bytes)
      if (content.includes('\0')) continue;
      // Strip the solution__ prefix from the stored path
      const cleanPath = filePath.replace(`/${SOLUTION_PREFIX}`, '/');
      solution.push({ path: cleanPath, content });
    } catch {
      // Skip files that can't be read (e.g. directories)
    }
  }
  return solution;
}

async function extractNotes(client: MicrosandboxClient): Promise<string | null> {
  try {
    return await client.readFile('/workspace/notes.md');
  } catch {
    return null;
  }
}

/** Generate a unique sandbox name for a test case. */
function sandboxName(testId: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `au-${testId}-${suffix}`.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
}

export async function executeTestCase(
  testCase: TestCase,
  target: TargetConfig,
  config: Config,
  paths: ProjectPaths,
  pool?: WorkerPool,
): Promise<void> {
  const client = new MicrosandboxClient(config.sandbox);
  // Register sandbox destruction as abort callback so Ctrl+C kills in-flight sandboxes
  const unregisterAbort = pool?.onAbort(async () => {
    await client.destroy();
  });

  try {
    const secrets = buildSecrets(config.sandbox?.secrets);
    const env = resolveEnv(config.sandbox?.env);
    const timeoutSecs = target.timeout ?? config.sandbox.defaultTimeout ?? 600;

    // Merge agent secret into sandbox secrets and set base URL env var
    const executorConfig: SandboxAgentConfig = config.agents?.executor
      ?? { command: 'claude', secret: { value: '$ANTHROPIC_API_KEY' } };
    secrets.push(buildAgentSecret(executorConfig.secret));
    const execAdapter = createAdapter(executorConfig);
    const baseUrlVar = executorConfig.secret.baseUrlEnvVar ?? execAdapter.baseUrlEnvVar;
    if (baseUrlVar && executorConfig.secret.baseUrl) {
      env[baseUrlVar] = executorConfig.secret.baseUrl;
    }

    await client.create(
      sandboxName(testCase.id),
      target.image,
      env,
      secrets,
      timeoutSecs,
    );

    // Scaffold workspace
    const setupLog = await scaffoldWorkspace(client, config, testCase);
    if (setupLog) {
      await saveResult(paths, testCase.id, 'setup.log', setupLog, target.name);
    }

    // Upload PROBLEM.md
    await client.uploadFiles([
      { path: '/workspace/PROBLEM.md', data: testCase.problemStatement },
    ]);

    // Install agent CLI inside the sandbox
    const adapter = createAdapter(executorConfig);
    const installCmd = adapter.installCommand;
    if (installCmd) {
      const installResult = await client.runCommand(installCmd);
      if (installResult.exitCode !== 0) {
        const installLog = [
          `Install command failed: ${installCmd}`,
          `Exit code: ${installResult.exitCode}`,
          installResult.stderr,
        ].filter(Boolean).join('\n');
        await saveResult(paths, testCase.id, 'install-error.log', installLog, target.name);
        throw new Error(`Agent install failed (exit ${installResult.exitCode}): ${installResult.stderr || installResult.stdout}`);
      }
    }

    // Upload public file sources (docs directories, etc.) for the executor
    const publicFileSources = getFileSources(config.publicInfo ?? []);
    const publicSourceDirs = publicFileSources.length > 0
      ? await uploadSources(client, publicFileSources, paths.cacheRepos)
      : [];

    // Start egress interception just before the agent runs — after infrastructure
    // traffic (scaffold, npm install, source upload) is done.
    const egressLogger = createEgressLogger(client.getSandbox());

    // Run agent — secrets are handled by microsandbox TLS interception
    const prompt = buildAgentPrompt(config, publicSourceDirs);
    const agentCmd = adapter.sandboxCommand(prompt);
    await saveResult(paths, testCase.id, 'agent-cmd.log', agentCmd, target.name);
    const agentResult = await client.runCommandTimed(agentCmd, {
      timeoutMs: timeoutSecs * 1000,
    });

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

    // Extract solution and notes even on non-zero exit — partial progress is valuable
    const solution = await extractSolution(client);
    await saveResult(
      paths,
      testCase.id,
      'generated-solution.json',
      JSON.stringify(solution, null, 2),
      target.name,
    );

    const notes = await extractNotes(client);
    if (notes) {
      await saveResult(paths, testCase.id, 'agent-notes.md', notes, target.name);
    }

    // Extract agent session log (each adapter knows where its CLI stores logs)
    try {
      const agentLog = await adapter.extractLog(client);
      if (agentLog) {
        await saveResult(paths, testCase.id, 'agent-session.jsonl', agentLog, target.name);
      }
    } catch {
      // Non-critical — log extraction is best-effort
    }

    // Capture workspace snapshot for judge sandbox reconstruction
    try {
      const tarResult = await client.runCommand(
        'tar czf /tmp/workspace-snapshot.tar.gz -C / workspace',
      );
      if (tarResult.exitCode === 0) {
        const tarData = await client.readBinaryFile('/tmp/workspace-snapshot.tar.gz');
        await saveBinaryResult(paths, testCase.id, 'workspace-snapshot.tar.gz', tarData, target.name);
      }
    } catch {
      // Non-critical — judge can fall back to re-scaffolding
    }

    // Save egress logs
    const egressLogs = egressLogger.getLogs();
    if (egressLogs.length > 0) {
      await saveResult(paths, testCase.id, 'agent-egress.log.json', JSON.stringify(egressLogs, null, 2), target.name);
    }
  } finally {
    unregisterAbort?.();
    await client.destroy();
  }
}

export interface StageOptions {
  config: Config;
  paths: ProjectPaths;
  testCases: TestCase[];
  onTestComplete?: (testId: string, target: string) => void;
  /** Filter test cases per target (e.g. to skip already-completed tests on resume). */
  filterForTarget?: (testCases: TestCase[], targetName: string) => TestCase[];
}

/**
 * Core execute stage: run test cases across all targets with WorkerPool.
 * Used by both `executeCommand` (standalone) and `evalCommand` (pipeline).
 */
export async function runExecuteStage(opts: StageOptions): Promise<{ aborted: boolean }> {
  const { config, paths, testCases, onTestComplete, filterForTarget } = opts;
  const concurrency = config.sandbox.concurrency ?? 3;

  for (const target of config.targets) {
    const targetTests = filterForTarget ? filterForTarget(testCases, target.name) : testCases;
    if (targetTests.length === 0) {
      console.log(chalk.dim(`\nTarget: ${target.name} — all tests already complete`));
      continue;
    }

    console.log(chalk.bold(`\nTarget: ${target.name} (${target.image})`));
    console.log(chalk.dim(`Concurrency: ${concurrency}\n`));

    const startTime = Date.now();
    const pool = new WorkerPool(concurrency);

    const poolResult = await pool.run(targetTests, async (tc) => {
      try {
        await executeTestCase(tc, target, config, paths, pool);
        onTestComplete?.(tc.id, target.name);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await saveResult(paths, tc.id, 'agent-error.log', message, target.name);
        throw err;
      }
    }, (info, tc, event) => {
      const elapsed = formatElapsed(Date.now() - startTime);
      if (event === 'start') {
        console.log(chalk.dim(`  [${info.completed + info.running}/${info.total}] ${tc.id} (${tc.difficulty}) — running... [${elapsed}]`));
      } else if (event === 'done') {
        console.log(chalk.green(`  [${info.completed}/${info.total}] ${tc.id} (${tc.difficulty}) — done [${elapsed}]`));
      } else {
        console.log(chalk.red(`  [${info.completed}/${info.total}] ${tc.id} (${tc.difficulty}) — failed [${elapsed}]`));
      }
    });

    if (poolResult.aborted) return { aborted: true };

    console.log('');
    console.log(chalk.bold(`Execution Summary (${target.name})`));
    console.log(`  Total:  ${targetTests.length}`);
    console.log(chalk.green(`  Passed: ${poolResult.passed}`));
    if (poolResult.failed > 0) {
      console.log(chalk.red(`  Failed: ${poolResult.failed}`));
    }
    console.log(chalk.dim(`  Elapsed: ${formatElapsed(Date.now() - startTime)}`));
  }

  return { aborted: false };
}

export async function executeCommand(paths: ProjectPaths, options: { testIds?: string[] } = {}): Promise<void> {
  const config = await loadConfig(paths.config);

  const spinner = ora('Loading test suite...').start();
  const allTestCases = await loadTestSuite(paths);
  const testCases = options.testIds
    ? allTestCases.filter(tc => options.testIds!.includes(tc.id))
    : allTestCases;
  spinner.succeed(`Loaded ${testCases.length} test case(s)${options.testIds ? ` (filtered from ${allTestCases.length})` : ''}`);

  await prepareSandbox(config);

  await runExecuteStage({ config, paths, testCases });
}
