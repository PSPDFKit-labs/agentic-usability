import chalk from 'chalk';
import { mkdir } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { loadConfig } from '../core/config.js';
import type { ProjectPaths, RunInfo } from '../types.js';
import { ensureProjectDirs, resolveRunPaths } from '../core/paths.js';
import { PipelineStateManager } from '../core/pipeline.js';
import { loadTestSuite } from '../core/suite-io.js';
import { reportCommand } from './report.js';
import { prepareSandbox, runExecuteStage } from './execute.js';
import { runJudgeStage } from './judge.js';
import { generateRunId, saveRunInfo, loadRunInfo, listRuns } from '../core/runs.js';

const STAGE_ORDER = ['execute', 'judge', 'report'];

/** Find the latest run whose pipeline state is not yet complete. */
async function findIncompleteRun(paths: ProjectPaths, runs: RunInfo[]): Promise<string | null> {
  for (const run of runs) {
    const rp = resolveRunPaths(paths, run.id);
    const mgr = new PipelineStateManager(rp.pipelineState);
    await mgr.load();
    if (mgr.getState().stage !== 'report') {
      return run.id;
    }
  }
  return null;
}

function stageIndex(stage: string): number {
  const idx = STAGE_ORDER.indexOf(stage);
  return idx === -1 ? 0 : idx;
}

export async function evalCommand(paths: ProjectPaths, options: {
  resume?: boolean;
  fresh?: boolean;
  label?: string;
  run?: string;
  testIds?: string[];
} = {}): Promise<void> {
  let pipelineAborted = false;
  const onSigint = () => { pipelineAborted = true; };
  process.on('SIGINT', onSigint);

  const config = await loadConfig(paths.config);
  await ensureProjectDirs(paths);

  // Determine which run to use
  let runId: string;
  if (options.resume) {
    if (options.run) {
      runId = options.run;
    } else {
      const runs = await listRuns(paths.results);
      const incompleteRun = await findIncompleteRun(paths, runs);
      if (!incompleteRun) {
        console.log(chalk.yellow('No incomplete run found to resume. Starting a new run.'));
        runId = generateRunId();
      } else {
        runId = incompleteRun;
      }
    }
  } else {
    runId = generateRunId();
  }

  const runPaths = resolveRunPaths(paths, runId);
  await mkdir(runPaths.results, { recursive: true });

  const stateManager = new PipelineStateManager(runPaths.pipelineState);

  if (options.fresh) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('This will clear all pipeline state. Continue? (y/N) ');
    rl.close();
    if (answer.toLowerCase() !== 'y') {
      console.log('Aborted.');
      return;
    }
    await stateManager.reset();
  }

  if (options.resume) {
    await stateManager.load();
    console.log(chalk.dim(`Resuming run ${runId} from stage: ${stateManager.getState().stage}`));
  } else {
    const labelStr = options.label ? ` "${options.label}"` : '';
    console.log(chalk.dim(`Starting run ${runId}${labelStr}`));
  }

  const totalStages = 3;

  const allSuiteTests = await loadTestSuite(paths);
  const testCases = options.testIds
    ? allSuiteTests.filter(tc => options.testIds!.includes(tc.id))
    : allSuiteTests;
  if (options.testIds && testCases.length === 0) {
    console.error(chalk.red(`No test cases matched: ${options.testIds.join(', ')}`));
    process.removeListener('SIGINT', onSigint);
    return;
  }
  if (options.testIds) {
    console.log(chalk.dim(`Filtering to ${testCases.length} test case(s): ${testCases.map(tc => tc.id).join(', ')}`));
  }
  const allTestIds = testCases.map((tc) => tc.id);
  stateManager.getState().testCases = testCases.length;
  await stateManager.save();

  // Write run manifest
  const runInfo: RunInfo = {
    id: runId,
    createdAt: new Date().toISOString(),
    targets: config.targets.map((t) => t.name),
    testCount: testCases.length,
    label: options.label ?? null,
  };
  if (options.resume) {
    const existing = await loadRunInfo(runPaths.results);
    if (existing) {
      runInfo.createdAt = existing.createdAt;
      runInfo.label = existing.label;
    }
  }
  await saveRunInfo(runPaths.results, runInfo);

  // Prepare sandbox env (resolve secrets + env vars)
  await prepareSandbox(config);

  // --- Stage 1: Execute ---
  if (stageIndex(stateManager.getState().stage) <= stageIndex('execute')) {
    console.log(chalk.bold.blue(`\n[Stage 1/${totalStages}] Executing test cases...`));

    const execResult = await runExecuteStage({
      config, paths: runPaths, testCases,
      onTestComplete: (id, target) => { stateManager.markTestComplete('execute', id, target); stateManager.save(); },
      filterForTarget: (tcs, targetName) => {
        const incomplete = stateManager.getIncompleteTests('execute', allTestIds, targetName);
        return tcs.filter((tc) => incomplete.includes(tc.id));
      },
    });

    if (execResult.aborted || pipelineAborted) {
      console.log(chalk.yellow('\nPipeline aborted. State saved — use --resume to continue.'));
      await stateManager.save();
      process.removeListener('SIGINT', onSigint);
      return;
    }

    stateManager.advanceStage('judge');
    await stateManager.save();
  } else {
    console.log(chalk.dim(`[Stage 1/${totalStages}] Execute — skipped (already complete)`));
  }

  // --- Stage 2: Judge ---
  if (stageIndex(stateManager.getState().stage) <= stageIndex('judge')) {
    console.log(chalk.bold.blue(`\n[Stage 2/${totalStages}] Judging solutions (sandboxed)...`));

    const judgeResult = await runJudgeStage({
      config, paths: runPaths, testCases,
      onTestComplete: (id, target) => { stateManager.markTestComplete('judge', id, target); stateManager.save(); },
      filterForTarget: (tcs, targetName) => {
        const incomplete = stateManager.getIncompleteTests('judge', allTestIds, targetName);
        return tcs.filter((tc) => incomplete.includes(tc.id));
      },
    });

    if (judgeResult.aborted || pipelineAborted) {
      console.log(chalk.yellow('\nPipeline aborted. State saved — use --resume to continue.'));
      await stateManager.save();
      process.removeListener('SIGINT', onSigint);
      return;
    }

    stateManager.advanceStage('report');
    await stateManager.save();
  } else {
    console.log(chalk.dim(`[Stage 2/${totalStages}] Judge — skipped (already complete)`));
  }

  // --- Stage 3: Report ---
  console.log(chalk.bold.blue(`\n[Stage ${totalStages}/${totalStages}] Generating report...`));
  await reportCommand(runPaths);

  process.removeListener('SIGINT', onSigint);
  console.log(chalk.bold.green('\nEvaluation complete!'));
}
