import chalk from 'chalk';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { loadDotenv } from '../core/env.js';
import { loadConfig } from '../core/config.js';
import { ensureProjectDirs, type ProjectPaths } from '../core/paths.js';
import { PipelineStateManager } from '../core/pipeline.js';
import { loadTestSuite, loadSolution, saveResult, formatElapsed } from '../core/suite-io.js';
import { reportCommand } from './report.js';
import { executeTestCase, startProxy } from './execute.js';
import { SandboxClient } from '../sandbox/opensandbox.js';

import { WorkerPool } from '../sandbox/worker-pool.js';
import { analyzeTokens } from '../scoring/tokens.js';
import { runJudge } from '../scoring/judge.js';

const STAGE_ORDER = ['execute', 'analyze', 'judge', 'report'];

function stageIndex(stage: string): number {
  const idx = STAGE_ORDER.indexOf(stage);
  return idx === -1 ? 0 : idx;
}

export async function evalCommand(paths: ProjectPaths, options: {
  resume?: boolean;
  fresh?: boolean;
  skipJudge?: boolean;
} = {}): Promise<void> {
  let pipelineAborted = false;
  const onSigint = () => { pipelineAborted = true; };
  process.on('SIGINT', onSigint);

  const config = await loadConfig(paths.config);
  await ensureProjectDirs(paths);
  const stateManager = new PipelineStateManager(paths.pipelineState);

  // Handle --fresh: clear state with confirmation
  if (options.fresh) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      'This will clear all pipeline state. Continue? (y/N) ',
    );
    rl.close();
    if (answer.toLowerCase() !== 'y') {
      console.log('Aborted.');
      return;
    }
    await stateManager.reset();
  }

  // Load existing state on --resume
  if (options.resume) {
    await stateManager.load();
    console.log(chalk.dim(`Resuming from stage: ${stateManager.getState().stage}`));
  }

  const totalStages = options.skipJudge ? 3 : 4;

  // Load test suite for all stages
  const testCases = await loadTestSuite(paths);
  const allTestIds = testCases.map((tc) => tc.id);
  stateManager.getState().testCases = testCases.length;
  await stateManager.save();

  // Stage 1: Execute (per target)
  const execStageNum = 1;
  if (stageIndex(stateManager.getState().stage) <= stageIndex('execute')) {
    console.log(
      chalk.bold.blue(`\n[Stage ${execStageNum}/${totalStages}] Executing test cases...`),
    );

    // Load .env (with op:// resolution) only for the execute stage — sandbox needs these secrets
    await loadDotenv();

    await SandboxClient.checkConnectivity(config.sandbox);

    // Start auth proxy: secrets stay on host, sandboxes get BASE_URL vars
    const { proxy, proxyEnv } = await startProxy(config);
    if (proxy) {
      const ports = proxy.listeners.map((l) => `${l.baseUrlVar}→:${l.port}`).join(', ');
      console.log(chalk.dim(`  Auth proxy listening (${ports})`));
    }

    const concurrency = config.sandbox.concurrency ?? 3;

    for (const target of config.targets) {
      const incomplete = stateManager.getIncompleteTests('execute', allTestIds);

      if (incomplete.length === 0) {
        console.log(chalk.dim(`  ${target.name}: All tests already executed`));
        continue;
      }

      console.log(
        chalk.dim(`  Target: ${target.name} | Concurrency: ${concurrency} | Tests: ${incomplete.length}`),
      );

      const incompleteTestCases = testCases.filter((tc) =>
        incomplete.includes(tc.id),
      );
      const pool = new WorkerPool(concurrency);
      const startTime = Date.now();

      const poolResult = await pool.run(
        incompleteTestCases,
        async (tc) => {
          try {
            await executeTestCase(tc, target, config, paths, pool, proxyEnv, proxy);
            stateManager.markTestComplete('execute', tc.id);
            await stateManager.save();
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await saveResult(paths, tc.id, 'error.log', message, target.name);
            throw err;
          }
        },
        (info, tc, event) => {
          const elapsed = formatElapsed(Date.now() - startTime);
          if (event === 'start') {
            console.log(
              chalk.dim(`  [${info.completed + info.running}/${info.total}] ${tc.id} (${tc.difficulty}) — running... [${elapsed}]`),
            );
          } else if (event === 'done') {
            console.log(
              chalk.green(`  [${info.completed}/${info.total}] ${tc.id} (${tc.difficulty}) — done [${elapsed}]`),
            );
          } else {
            console.log(
              chalk.red(`  [${info.completed}/${info.total}] ${tc.id} (${tc.difficulty}) — failed [${elapsed}]`),
            );
          }
        },
      );

      if (poolResult.aborted || pipelineAborted) {
        console.log(chalk.yellow('\nPipeline aborted by user (Ctrl+C). State saved — use --resume to continue.'));
        await proxy?.stop();
        await stateManager.save();
        process.removeListener('SIGINT', onSigint);
        return;
      }
    }

    await proxy?.stop();
    stateManager.advanceStage('analyze');
    await stateManager.save();
  } else {
    console.log(
      chalk.dim(`[Stage ${execStageNum}/${totalStages}] Execute — skipped (already complete)`),
    );
  }

  // Stage 2: Analyze (per target)
  const analyzeStageNum = 2;
  if (stageIndex(stateManager.getState().stage) <= stageIndex('analyze')) {
    console.log(
      chalk.bold.blue(`\n[Stage ${analyzeStageNum}/${totalStages}] Analyzing solutions...`),
    );

    const incomplete = stateManager.getIncompleteTests('analyze', allTestIds);

    for (const target of config.targets) {
      for (const tc of testCases) {
        if (!incomplete.includes(tc.id)) continue;

        const solution = await loadSolution(paths, tc.id, target.name);
        const analysis = analyzeTokens(
          solution ?? [],
          tc.targetApis,
          tc.expectedTokens,
          tc.id,
          target.name,
        );

        await saveResult(
          paths,
          tc.id,
          'token-analysis.json',
          JSON.stringify(analysis, null, 2),
          target.name,
        );

        if (!solution) {
          console.log(chalk.yellow(`  ${tc.id} [${target.name}]: No solution found (0% coverage)`));
        } else {
          const apiFound = analysis.apis.filter((a) => a.found).length;
          const tokenFound = analysis.tokens.filter((t) => t.found).length;
          console.log(
            `  ${tc.id} [${target.name}]: API ${Math.round(analysis.apiCoverage)}% (${apiFound}/${tc.targetApis.length}), Tokens ${Math.round(analysis.tokenCoverage)}% (${tokenFound}/${tc.expectedTokens.length})`,
          );
        }
      }
    }

    // Mark all as complete after processing all targets
    for (const id of incomplete) {
      stateManager.markTestComplete('analyze', id);
    }

    stateManager.advanceStage('judge');
    await stateManager.save();
  } else {
    console.log(
      chalk.dim(`[Stage ${analyzeStageNum}/${totalStages}] Analyze — skipped (already complete)`),
    );
  }

  // Stage 3: Judge (optional, per target)
  if (!options.skipJudge) {
    const judgeStageNum = 3;
    if (stageIndex(stateManager.getState().stage) <= stageIndex('judge')) {
      console.log(
        chalk.bold.blue(`\n[Stage ${judgeStageNum}/${totalStages}] Judging solutions...`),
      );

      const incomplete = stateManager.getIncompleteTests('judge', allTestIds);
      const judgeConfig = config.agents?.judge ?? { command: 'claude' };

      for (const target of config.targets) {
        for (const tc of testCases) {
          if (!incomplete.includes(tc.id)) continue;

          const solution = await loadSolution(paths, tc.id, target.name);
          if (!solution) {
            console.log(
              chalk.yellow(`  ${tc.id} [${target.name}]: No solution found — skipping judge`),
            );
            continue;
          }

          let agentNotes: string | undefined;
          try {
            agentNotes = await readFile(join(paths.results, target.name, tc.id, 'agent-notes.md'), 'utf-8');
          } catch {
            // No notes available
          }

          try {
            const score = await runJudge(tc, solution, judgeConfig, target.name, agentNotes);
            await saveResult(
              paths,
              tc.id,
              'judge.json',
              JSON.stringify(score, null, 2),
              target.name,
            );

            const matchIcon = score.overallVerdict
              ? chalk.green('PASS')
              : chalk.red('FAIL');
            console.log(
              `  ${tc.id} [${target.name}]: Discovery ${score.apiDiscovery}%, Correctness ${score.callCorrectness}%, Complete ${score.completeness}%, Functional ${score.functionalCorrectness}% [${matchIcon}]`,
            );
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.log(chalk.red(`  ${tc.id} [${target.name}]: Judge failed — ${message}`));
            await saveResult(paths, tc.id, 'judge-error.log', message, target.name);
          }
        }
      }

      // Mark all as complete after processing all targets
      for (const id of incomplete) {
        stateManager.markTestComplete('judge', id);
      }

      stateManager.advanceStage('report');
      await stateManager.save();
    } else {
      console.log(
        chalk.dim(`[Stage ${judgeStageNum}/${totalStages}] Judge — skipped (already complete)`),
      );
    }
  } else {
    console.log(chalk.yellow('\n[Stage] Judge — skipped (--skip-judge)'));
    stateManager.advanceStage('report');
    await stateManager.save();
  }

  // Final stage: Report
  console.log(
    chalk.bold.blue(`\n[Stage ${totalStages}/${totalStages}] Generating report...`),
  );
  await reportCommand(paths);

  process.removeListener('SIGINT', onSigint);
  console.log(chalk.bold.green('\nEvaluation complete!'));
}
