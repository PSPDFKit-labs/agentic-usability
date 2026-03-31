import chalk from 'chalk';
import { createInterface } from 'node:readline/promises';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { loadConfig, ensureWorkingDir } from '../core/config.js';
import { PipelineStateManager } from '../core/pipeline.js';
import { generateCommand } from './generate.js';
import { reportCommand } from './report.js';
import { executeTestCase, loadTestSuite } from './execute.js';
import { SandboxClient } from '../sandbox/opensandbox.js';
import { fetchAndCacheDocs } from '../sandbox/docs-fetcher.js';
import { WorkerPool } from '../sandbox/worker-pool.js';
import { analyzeTokens } from '../scoring/tokens.js';
import { runJudge } from '../scoring/judge.js';
import type { SolutionFile } from '../core/types.js';

const RESULTS_DIR = '.agentic-usability/results';
const STAGE_ORDER = ['generate', 'execute', 'analyze', 'judge', 'report'];

function stageIndex(stage: string): number {
  const idx = STAGE_ORDER.indexOf(stage);
  return idx === -1 ? 0 : idx;
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return minutes > 0 ? `${minutes}m${secs}s` : `${secs}s`;
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

async function loadSolution(testId: string): Promise<SolutionFile[] | null> {
  try {
    const raw = await readFile(
      resolve(join(RESULTS_DIR, testId, 'generated-solution.json')),
      'utf-8',
    );
    return JSON.parse(raw) as SolutionFile[];
  } catch {
    return null;
  }
}

export async function runCommand(options: {
  resume?: boolean;
  fresh?: boolean;
  skipJudge?: boolean;
} = {}): Promise<void> {
  const config = await loadConfig();
  const workingDir = await ensureWorkingDir();
  const stateManager = new PipelineStateManager(workingDir);

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

  const totalStages = options.skipJudge ? 4 : 5;

  // Stage 1: Generate
  const genStageNum = 1;
  if (stageIndex(stateManager.getState().stage) <= stageIndex('generate')) {
    console.log(
      chalk.bold.blue(`\n[Stage ${genStageNum}/${totalStages}] Generating test suite...`),
    );
    await generateCommand({ fresh: options.fresh });
    stateManager.advanceStage('execute');
    await stateManager.save();
  } else {
    console.log(
      chalk.dim(`[Stage ${genStageNum}/${totalStages}] Generate — skipped (already complete)`),
    );
  }

  // Load test suite for subsequent stages
  const testCases = await loadTestSuite(config);
  const allTestIds = testCases.map((tc) => tc.id);
  stateManager.getState().testCases = testCases.length;
  await stateManager.save();

  // Stage 2: Execute
  const execStageNum = 2;
  if (stageIndex(stateManager.getState().stage) <= stageIndex('execute')) {
    console.log(
      chalk.bold.blue(`\n[Stage ${execStageNum}/${totalStages}] Executing test cases...`),
    );

    const incomplete = stateManager.getIncompleteTests('execute', allTestIds);
    if (incomplete.length === 0) {
      console.log(chalk.dim('  All tests already executed'));
    } else {
      await SandboxClient.checkConnectivity(config.sandbox);

      const docsContent = config.publicInfo
        ? await fetchAndCacheDocs(config.publicInfo)
        : '';

      const target = config.targets[0];
      const concurrency = config.sandbox.concurrency ?? 3;
      console.log(
        chalk.dim(`  Target: ${target.name} | Concurrency: ${concurrency} | Tests: ${incomplete.length}`),
      );

      const incompleteTestCases = testCases.filter((tc) =>
        incomplete.includes(tc.id),
      );
      const pool = new WorkerPool(concurrency);
      const startTime = Date.now();

      await pool.run(
        incompleteTestCases,
        async (tc) => {
          try {
            await executeTestCase(tc, target, config, docsContent);
            stateManager.markTestComplete('execute', tc.id);
            await stateManager.save();
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await saveResult(tc.id, 'error.log', message);
            throw err; // let WorkerPool handle retry
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
    }

    stateManager.advanceStage('analyze');
    await stateManager.save();
  } else {
    console.log(
      chalk.dim(`[Stage ${execStageNum}/${totalStages}] Execute — skipped (already complete)`),
    );
  }

  // Stage 3: Analyze
  const analyzeStageNum = 3;
  if (stageIndex(stateManager.getState().stage) <= stageIndex('analyze')) {
    console.log(
      chalk.bold.blue(`\n[Stage ${analyzeStageNum}/${totalStages}] Analyzing solutions...`),
    );

    const incomplete = stateManager.getIncompleteTests('analyze', allTestIds);
    const target = config.targets[0];

    for (const tc of testCases) {
      if (!incomplete.includes(tc.id)) continue;

      const solution = await loadSolution(tc.id);
      const analysis = analyzeTokens(
        solution ?? [],
        tc.targetApis,
        tc.expectedTokens,
        tc.id,
        target.name,
      );

      await saveResult(
        tc.id,
        'token-analysis.json',
        JSON.stringify(analysis, null, 2),
      );

      if (!solution) {
        console.log(chalk.yellow(`  ${tc.id}: No solution found (0% coverage)`));
      } else {
        const apiFound = analysis.apis.filter((a) => a.found).length;
        const tokenFound = analysis.tokens.filter((t) => t.found).length;
        console.log(
          `  ${tc.id}: API ${Math.round(analysis.apiCoverage)}% (${apiFound}/${tc.targetApis.length}), Tokens ${Math.round(analysis.tokenCoverage)}% (${tokenFound}/${tc.expectedTokens.length})`,
        );
      }

      stateManager.markTestComplete('analyze', tc.id);
      await stateManager.save();
    }

    stateManager.advanceStage('judge');
    await stateManager.save();
  } else {
    console.log(
      chalk.dim(`[Stage ${analyzeStageNum}/${totalStages}] Analyze — skipped (already complete)`),
    );
  }

  // Stage 4: Judge (optional)
  if (!options.skipJudge) {
    const judgeStageNum = 4;
    if (stageIndex(stateManager.getState().stage) <= stageIndex('judge')) {
      console.log(
        chalk.bold.blue(`\n[Stage ${judgeStageNum}/${totalStages}] Judging solutions...`),
      );

      const incomplete = stateManager.getIncompleteTests('judge', allTestIds);
      const target = config.targets[0];
      const judgeConfig = config.agents?.judge ?? { command: 'claude' };

      for (const tc of testCases) {
        if (!incomplete.includes(tc.id)) continue;

        const solution = await loadSolution(tc.id);
        if (!solution) {
          console.log(
            chalk.yellow(`  ${tc.id}: No solution found — skipping judge`),
          );
          stateManager.markTestComplete('judge', tc.id);
          await stateManager.save();
          continue;
        }

        try {
          const score = await runJudge(tc, solution, judgeConfig, target.name);
          await saveResult(
            tc.id,
            'judge.json',
            JSON.stringify(score, null, 2),
          );

          const matchIcon = score.functionalMatch
            ? chalk.green('MATCH')
            : chalk.red('NO MATCH');
          console.log(
            `  ${tc.id}: Similarity ${score.overallSimilarity}% [${matchIcon}]`,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.log(chalk.red(`  ${tc.id}: Judge failed — ${message}`));
          await saveResult(tc.id, 'judge-error.log', message);
        }

        stateManager.markTestComplete('judge', tc.id);
        await stateManager.save();
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
  await reportCommand();

  console.log(chalk.bold.green('\nPipeline complete!'));
}
