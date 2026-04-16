import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../core/config.js';
import { loadTestSuite, saveResult, formatElapsed } from '../core/suite-io.js';
import { SandboxClient, getSandboxHostAddress } from '../sandbox/opensandbox.js';
import { rewriteEnv, applyProxyUrls, stampProxyTag } from '../proxy/env-rewriter.js';
import { startAuthProxy, type AuthProxyHandle } from '../proxy/auth-proxy.js';
import { scaffoldWorkspace } from '../sandbox/scaffolding.js';
import { WorkerPool } from '../sandbox/worker-pool.js';
import { createAdapter } from '../agents/adapter.js';
import type { ProjectPaths } from '../core/paths.js';
import type { Config, TestCase, SolutionFile, TargetConfig } from '../core/types.js';

export interface ProxySetupResult {
  proxy?: AuthProxyHandle;
  proxyEnv?: Record<string, string>;
}

/**
 * Resolve sandbox env vars, start the auth proxy for known secrets,
 * and return the rewritten env (with BASE_URL vars) + proxy handle.
 * Call once before executing test cases; stop the proxy when done.
 */
export async function startProxy(config: Config): Promise<ProxySetupResult> {
  const sandboxEnv = resolveEnv(config.sandbox?.env);
  const hostAddr = getSandboxHostAddress();
  let proxy: AuthProxyHandle | undefined;
  let proxyEnv: Record<string, string> | undefined;

  const { proxyTargets, baseUrlVarMap, cleanEnv } = rewriteEnv(sandboxEnv);
  if (proxyTargets.length > 0) {
    proxy = await startAuthProxy(proxyTargets, baseUrlVarMap);
    proxyEnv = applyProxyUrls(cleanEnv, proxy.listeners, hostAddr);
  } else if (sandboxEnv && Object.keys(sandboxEnv).length > 0) {
    proxyEnv = sandboxEnv;
  }

  return { proxy, proxyEnv };
}

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
          `Environment variable '${hostVar}' referenced in sandbox.env.${key} is not set on the host`,
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

  const langInstruction = config.publicInfo?.language
    ? `\nIMPORTANT: Write your solution in ${config.publicInfo.language}.\n`
    : '';

  // Build docs context: URLs + lightweight hints
  const docsLines: string[] = [];
  if (config.publicInfo?.packageName) {
    docsLines.push(`Package: ${config.publicInfo.packageName}`);
  }
  if (config.publicInfo?.installCommand) {
    docsLines.push(`Install: ${config.publicInfo.installCommand}`);
  }
  if (config.publicInfo?.docsUrl) {
    docsLines.push(`Documentation: ${config.publicInfo.docsUrl}`);
  }
  if (config.publicInfo?.guides?.length) {
    docsLines.push(`Guides:\n${config.publicInfo.guides.map((u) => `  - ${u}`).join('\n')}`);
  }
  if (config.publicInfo?.additionalContext) {
    docsLines.push(`\n${config.publicInfo.additionalContext}`);
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

async function extractNotes(client: SandboxClient): Promise<string | null> {
  try {
    return await client.readFile('/workspace/notes.md');
  } catch {
    return null;
  }
}

export async function executeTestCase(
  testCase: TestCase,
  target: TargetConfig,
  config: Config,
  paths: ProjectPaths,
  pool?: WorkerPool,
  /** Pre-rewritten env: secrets replaced with *_BASE_URL vars pointing to the auth proxy. */
  proxyEnv?: Record<string, string>,
  /** Auth proxy handle for per-test-case log extraction */
  proxyHandle?: AuthProxyHandle,
): Promise<void> {
  const client = new SandboxClient(config.sandbox);
  // Register sandbox destruction as abort callback so Ctrl+C kills in-flight sandboxes
  const unregisterAbort = pool?.onAbort(async () => {
    await client.destroy();
  });

  try {
    // Stamp test case ID onto proxy passthrough vars, then bake all env into the container
    const tcEnv = proxyEnv ? stampProxyTag(proxyEnv, testCase.id) : undefined;
    const containerEnv = tcEnv && Object.keys(tcEnv).length > 0 ? tcEnv : undefined;
    await client.create(
      target.image,
      containerEnv,
      target.timeout ?? config.sandbox.defaultTimeout,
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
    const executorConfig = config.agents?.executor ?? { command: 'claude' };
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

    // Run agent — secrets are proxied, only BASE_URL vars enter the sandbox
    const prompt = buildAgentPrompt(testCase, config);
    const agentCmd = adapter.sandboxCommand(prompt);
    await saveResult(paths, testCase.id, 'agent-cmd.log', agentCmd, target.name);
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
  } finally {
    // Save proxy logs for this test case (even on failure, for debugging)
    if (proxyHandle) {
      const tcLogs = proxyHandle.getLogsForTestCase(testCase.id);
      if (tcLogs.length > 0) {
        await saveResult(paths, testCase.id, 'proxy.log.json', JSON.stringify(tcLogs, null, 2), target.name);
      }
    }
    unregisterAbort?.();
    await client.destroy();
  }
}

export async function executeCommand(paths: ProjectPaths, options: { testIds?: string[] } = {}): Promise<void> {
  const config = await loadConfig(paths.config);

  const spinner = ora('Loading test suite...').start();
  const allTestCases = await loadTestSuite(paths);
  const testCases = options.testIds
    ? allTestCases.filter(tc => options.testIds!.includes(tc.id))
    : allTestCases;
  spinner.succeed(`Loaded ${testCases.length} test case(s)${options.testIds ? ` (filtered from ${allTestCases.length})` : ''}`);

  // Validate connectivity
  spinner.start('Checking OpenSandbox connectivity...');
  await SandboxClient.checkConnectivity(config.sandbox);
  spinner.succeed('OpenSandbox server is reachable');

  // Start auth proxy: secrets stay on the host, sandboxes only get BASE_URL vars
  const sandboxEnv = resolveEnv(config.sandbox?.env);
  const hostAddr = getSandboxHostAddress();
  let proxy: AuthProxyHandle | undefined;
  let proxyEnv: Record<string, string> | undefined;

  const { proxyTargets, baseUrlVarMap, cleanEnv } = rewriteEnv(sandboxEnv);
  if (proxyTargets.length > 0) {
    spinner.start('Starting auth proxy...');
    proxy = await startAuthProxy(proxyTargets, baseUrlVarMap);
    proxyEnv = applyProxyUrls(cleanEnv, proxy.listeners, hostAddr);
    const ports = proxy.listeners.map((l) => `${l.baseUrlVar}→:${l.port}`).join(', ');
    spinner.succeed(`Auth proxy listening (${ports})`);
  } else if (sandboxEnv && Object.keys(sandboxEnv).length > 0) {
    // No known secrets found, pass through as-is
    proxyEnv = sandboxEnv;
  }

  const concurrency = config.sandbox.concurrency ?? 3;

  try {
    for (const target of config.targets) {
      console.log(chalk.bold(`\nTarget: ${target.name} (${target.image})`));
      console.log(chalk.dim(`Concurrency: ${concurrency}\n`));

      const startTime = Date.now();
      const pool = new WorkerPool(concurrency);

      const executeFn = async (tc: TestCase): Promise<void> => {
        try {
          await executeTestCase(tc, target, config, paths, pool, proxyEnv, proxy);
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
  } finally {
    await proxy?.stop();
  }
}
