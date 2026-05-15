import chalk from 'chalk';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadDotenv } from '../core/env.js';
import { loadConfig } from '../core/config.js';
import { loadTestSuite, loadBinaryResult } from '../core/suite-io.js';
import { loadJsonFile } from '../core/results.js';
import { MicrosandboxClient, buildSecrets, applyAgentAuth, resolveEnv } from '../sandbox/microsandbox.js';
import { scaffoldWorkspace, uploadSources } from '../sandbox/scaffolding.js';
import { createEgressLogger } from '../sandbox/egress-logger.js';
import { createAdapter } from '../agents/adapter.js';
import { deduplicateSources } from '../core/source-resolver.js';
import { getFileSources } from '../types.js';
import type { Config, ProjectPaths, SandboxAgentConfig, SolutionFile } from '../types.js';

export interface SandboxOptions {
  target?: string;
  mode?: 'executor' | 'judge';
  test?: string;
  run?: string;
  output?: string;
}

function sandboxName(): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `au-debug-${suffix}`;
}

function getAgentConfig(config: Config, mode: 'executor' | 'judge'): SandboxAgentConfig {
  const agentConfig = config.agents?.[mode];
  if (!agentConfig) {
    throw new Error(`No agents.${mode} configured`);
  }
  return agentConfig;
}

export async function sandboxCommand(paths: ProjectPaths, options: SandboxOptions): Promise<void> {
  await loadDotenv();
  const config = await loadConfig(paths.config);

  // Pick target
  const target = options.target
    ? config.targets.find(t => t.name === options.target)
    : config.targets[0];
  if (!target) {
    throw new Error(options.target
      ? `Target '${options.target}' not found in config`
      : 'No targets configured');
  }

  // Build secrets and env
  const secrets = buildSecrets(config.sandbox?.secrets);
  const env = resolveEnv(config.sandbox?.env);
  const timeoutSecs = target.timeout ?? config.sandbox.defaultTimeout ?? 600;

  // If mode is set, merge agent secret
  let agentConfig: SandboxAgentConfig | undefined;
  let adapter: ReturnType<typeof createAdapter> | undefined;
  if (options.mode) {
    agentConfig = getAgentConfig(config, options.mode);
    adapter = createAdapter(agentConfig);
    applyAgentAuth(agentConfig.secret, adapter, secrets, env);
  }

  // Prepare output directory for artifacts
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = options.output ?? join(paths.results, `sandbox-debug-${timestamp}`);
  await mkdir(outDir, { recursive: true });

  const client = new MicrosandboxClient(config.sandbox);
  const logLines: string[] = [];

  try {
    console.log(chalk.bold('\nLaunching debug sandbox...\n'));
    console.log(`  ${chalk.cyan('Image:')}   ${target.image}`);
    console.log(`  ${chalk.cyan('Target:')}  ${target.name}`);
    if (options.mode) console.log(`  ${chalk.cyan('Mode:')}    ${options.mode}`);
    if (options.test) console.log(`  ${chalk.cyan('Test:')}    ${options.test}`);
    console.log(`  ${chalk.cyan('Logs:')}    ${outDir}`);
    console.log('');

    await client.create(sandboxName(), target.image, env, secrets, timeoutSecs);

    // Mode-specific setup
    if (options.mode && agentConfig && adapter) {
      // Load test case if specified
      let testCase;
      if (options.test) {
        const testCases = await loadTestSuite(paths);
        testCase = testCases.find(tc => tc.id === options.test);
        if (!testCase) {
          throw new Error(`Test case '${options.test}' not found in suite`);
        }

        // Scaffold workspace
        const setupLog = await scaffoldWorkspace(client, config, testCase);
        if (setupLog) {
          console.log(chalk.dim(setupLog));
          logLines.push(setupLog);
        }
      }

      // Install agent CLI
      const installCmd = adapter.installCommand;
      if (installCmd) {
        console.log(chalk.dim(`Installing agent: ${installCmd}`));
        const installResult = await client.runCommand(installCmd);
        if (installResult.exitCode !== 0) {
          const msg = `Install failed (exit ${installResult.exitCode}):\n${installResult.stderr || installResult.stdout}`;
          console.error(chalk.red(msg));
          logLines.push(msg);
        } else {
          console.log(chalk.dim('Agent installed.'));
          logLines.push(`Agent installed: ${installCmd}`);
        }
      }

      // Test case-specific setup
      if (testCase) {
        if (options.mode === 'executor') {
          await client.uploadFiles([
            { path: '/workspace/PROBLEM.md', data: testCase.problemStatement },
          ]);

          const publicFileSources = getFileSources(config.publicInfo ?? []);
          if (publicFileSources.length > 0) {
            console.log(chalk.dim('Uploading public sources...'));
            await uploadSources(client, publicFileSources, paths.cacheRepos);
          }
        } else if (options.mode === 'judge') {
          const runPaths = options.run
            ? { ...paths, results: join(paths.results, options.run) }
            : paths;

          const snapshot = await loadBinaryResult(runPaths, testCase.id, 'workspace-snapshot.tar.gz', target.name);
          if (snapshot) {
            console.log(chalk.dim('Restoring workspace snapshot...'));
            await client.uploadBinaryFile('/tmp/workspace-snapshot.tar.gz', snapshot);
            await client.runCommand('tar xzf /tmp/workspace-snapshot.tar.gz -C / && rm -f /tmp/workspace-snapshot.tar.gz');
          } else {
            await client.uploadFiles([
              { path: '/workspace/PROBLEM.md', data: testCase.problemStatement },
            ]);
            const solutionPath = join(runPaths.results, target.name, testCase.id, 'generated-solution.json');
            const solution = await loadJsonFile<SolutionFile[]>(solutionPath);
            if (solution && solution.length > 0) {
              const files = solution.map(f => ({
                path: `/workspace/solution/solution__${f.path.split('/').pop()}`,
                data: f.content,
              }));
              await client.uploadFiles(files);
            }
          }

          const allSources = deduplicateSources(config.privateInfo ?? [], config.publicInfo ?? []);
          if (allSources.length > 0) {
            console.log(chalk.dim('Uploading sources...'));
            await uploadSources(client, allSources, paths.cacheRepos);
          }
        }
      }
    }

    // Start egress interception before handing over to the user
    const egressLogger = createEgressLogger(client.getSandbox());

    console.log(chalk.bold('\nDropping into sandbox shell. Press Ctrl-] to detach.\n'));
    await client.getSandbox().attachShell();

    // --- Extract artifacts after user detaches ---
    console.log(chalk.dim('\nExtracting artifacts...'));

    // 1. Egress logs
    const egressLogs = egressLogger.getLogs();
    if (egressLogs.length > 0) {
      await writeFile(join(outDir, 'agent-egress.log.json'), JSON.stringify(egressLogs, null, 2));
      console.log(chalk.dim(`  agent-egress.log.json (${egressLogs.length} entries)`));
    }

    // 2. Workspace snapshot
    try {
      const tarResult = await client.runCommand(
        'tar czf /tmp/workspace-snapshot.tar.gz -C / workspace',
      );
      if (tarResult.exitCode === 0) {
        const tarData = await client.readBinaryFile('/tmp/workspace-snapshot.tar.gz');
        await writeFile(join(outDir, 'workspace-snapshot.tar.gz'), tarData);
        console.log(chalk.dim(`  workspace-snapshot.tar.gz (${(tarData.length / 1024).toFixed(0)} KB)`));
      }
    } catch {
      // Best-effort
    }

    // 3. Agent session log
    if (adapter) {
      try {
        const sessionLog = await adapter.extractLog(client);
        if (sessionLog) {
          await writeFile(join(outDir, 'agent-session.jsonl'), sessionLog);
          console.log(chalk.dim('  agent-session.jsonl'));
        }
      } catch {
        // Best-effort
      }
    }
  } finally {
    // 4. Setup log
    if (logLines.length > 0) {
      await writeFile(join(outDir, 'setup.log'), logLines.join('\n'));
      console.log(chalk.dim('  setup.log'));
    }

    console.log(chalk.dim(`\nArtifacts saved to ${outDir}`));
    console.log(chalk.dim('Destroying sandbox...'));
    await client.destroy();
    console.log(chalk.dim('Done.'));
  }
}
