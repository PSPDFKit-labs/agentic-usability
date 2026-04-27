import chalk from 'chalk';
import ora from 'ora';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../core/config.js';
import { loadTestSuite, loadSolution, saveResult, formatElapsed } from '../core/suite-io.js';
import { runSandboxedJudge } from '../scoring/judge.js';
import { prepareSandbox, type StageOptions } from './execute.js';
import { WorkerPool } from '../sandbox/worker-pool.js';
import type { ProjectPaths, SandboxAgentConfig } from '../types.js';

/**
 * Core judge stage: run sandboxed judge for each test case across all targets.
 * Used by both `judgeCommand` (standalone) and `evalCommand` (pipeline).
 */
export async function runJudgeStage(opts: StageOptions): Promise<{ aborted: boolean }> {
  const { config, paths, testCases, onTestComplete, filterForTarget } = opts;
  const judgeConfig: SandboxAgentConfig = config.agents?.judge
    ?? { command: 'claude', secret: { value: '$ANTHROPIC_API_KEY' } };
  const concurrency = config.sandbox.concurrency ?? 3;

  for (const target of config.targets) {
    const targetTests = filterForTarget ? filterForTarget(testCases, target.name) : testCases;
    if (targetTests.length === 0) {
      console.log(chalk.dim(`\nTarget: ${target.name} — all tests already judged`));
      continue;
    }

    console.log(chalk.bold(`\nJudging solutions for target: ${target.name}`));
    console.log(chalk.dim(`Concurrency: ${concurrency}\n`));

    const pool = new WorkerPool(concurrency);
    const startTime = Date.now();
    let skipped = 0;

    const poolResult = await pool.run(targetTests, async (tc) => {
      const solution = await loadSolution(paths, tc.id, target.name);

      if (!solution) {
        skipped++;
        let reason = 'no solution files produced';
        try {
          const errorLog = await readFile(join(paths.results, target.name, tc.id, 'agent-error.log'), 'utf-8');
          if (errorLog.includes('terminated')) reason = 'agent terminated';
        } catch { /* no error log */ }

        const dnfScore = {
          testId: tc.id,
          target: target.name,
          apiDiscovery: 0,
          callCorrectness: 0,
          completeness: 0,
          functionalCorrectness: 0,
          overallVerdict: false,
          notes: `DNF — ${reason}. Check agent-error.log and agent-egress.log.json for details.`,
        };
        await saveResult(paths, tc.id, 'judge.json', JSON.stringify(dnfScore, null, 2), target.name);
        console.log(chalk.yellow(`  ${tc.id}: DNF — ${reason}`));
        onTestComplete?.(tc.id, target.name);
        return;
      }

      let agentNotes: string | undefined;
      try {
        agentNotes = await readFile(join(paths.results, target.name, tc.id, 'agent-notes.md'), 'utf-8');
      } catch {
        // No notes available
      }

      try {
        const score = await runSandboxedJudge(
          tc, solution, judgeConfig, target, config, paths,
          agentNotes, pool,
        );

        await saveResult(
          paths,
          tc.id,
          'judge.json',
          JSON.stringify(score, null, 2),
          target.name,
        );

        const matchIcon = score.overallVerdict ? chalk.green('PASS') : chalk.red('FAIL');
        console.log(
          `  ${tc.id} [${target.name}]: Discovery ${score.apiDiscovery}%, Correctness ${score.callCorrectness}%, Complete ${score.completeness}%, Functional ${score.functionalCorrectness}% [${matchIcon}]`,
        );

        onTestComplete?.(tc.id, target.name);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await saveResult(paths, tc.id, 'judge-error.log', message, target.name);
        throw err;
      }
    }, (info, tc, event) => {
      const elapsed = formatElapsed(Date.now() - startTime);
      if (event === 'start') {
        console.log(chalk.dim(`  [${info.completed + info.running}/${info.total}] ${tc.id} — judging... [${elapsed}]`));
      } else if (event === 'done') {
        console.log(chalk.green(`  [${info.completed}/${info.total}] ${tc.id} — judged [${elapsed}]`));
      } else {
        console.log(chalk.red(`  [${info.completed}/${info.total}] ${tc.id} — judge failed [${elapsed}]`));
      }
    });

    if (poolResult.aborted) return { aborted: true };

    console.log('');
    console.log(chalk.bold(`Judge Summary (${target.name})`));
    console.log(`  Total:  ${targetTests.length}`);
    console.log(chalk.green(`  Judged: ${poolResult.passed - skipped}`));
    if (skipped > 0) {
      console.log(chalk.yellow(`  Skipped: ${skipped}`));
    }
    if (poolResult.failed > 0) {
      console.log(chalk.red(`  Failed: ${poolResult.failed}`));
    }
    console.log(chalk.dim(`  Elapsed: ${formatElapsed(Date.now() - startTime)}`));
  }

  return { aborted: false };
}

export async function judgeCommand(paths: ProjectPaths, options: { testIds?: string[] } = {}): Promise<void> {

  const config = await loadConfig(paths.config);

  const spinner = ora('Loading test suite...').start();
  const allTestCases = await loadTestSuite(paths);
  const testCases = options.testIds
    ? allTestCases.filter(tc => options.testIds!.includes(tc.id))
    : allTestCases;
  spinner.succeed(`Loaded ${testCases.length} test case(s)${options.testIds ? ` (filtered from ${allTestCases.length})` : ''}`);

  await prepareSandbox(config);

  await runJudgeStage({ config, paths, testCases });

  console.log(chalk.dim(`\nResults saved to ${paths.results}`));
}
