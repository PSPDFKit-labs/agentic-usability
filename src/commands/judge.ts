import chalk from 'chalk';
import ora from 'ora';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../core/config.js';
import { loadTestSuite, loadSolution, saveResult } from '../core/suite-io.js';
import { runJudge } from '../scoring/judge.js';
import type { ProjectPaths } from '../types.js';

export async function judgeCommand(paths: ProjectPaths, options: { skipJudge?: boolean; testIds?: string[] } = {}): Promise<void> {
  if (options.skipJudge) {
    console.log(chalk.yellow('Judge stage skipped (--skip-judge flag)'));
    return;
  }

  const config = await loadConfig(paths.config);

  const spinner = ora('Loading test suite...').start();
  const allTestCases = await loadTestSuite(paths);
  const testCases = options.testIds
    ? allTestCases.filter(tc => options.testIds!.includes(tc.id))
    : allTestCases;
  spinner.succeed(`Loaded ${testCases.length} test case(s)${options.testIds ? ` (filtered from ${allTestCases.length})` : ''}`);

  const judgeConfig = config.agents?.judge ?? { command: 'claude' };

  for (const target of config.targets) {
    console.log(chalk.bold(`\nJudging solutions for target: ${target.name}\n`));

    for (const tc of testCases) {
      const solution = await loadSolution(paths, tc.id, target.name);

      if (!solution) {
        console.log(
          chalk.yellow(`${tc.id}: No generated solution found — skipping`),
        );
        continue;
      }

      let agentNotes: string | undefined;
      try {
        agentNotes = await readFile(join(paths.results, target.name, tc.id, 'agent-notes.md'), 'utf-8');
      } catch {
        // No notes available
      }

      const judgeSpinner = ora(`${tc.id}: Running judge...`).start();

      try {
        const score = await runJudge(tc, solution, judgeConfig, target.name, agentNotes);

        await saveResult(
          paths,
          tc.id,
          'judge.json',
          JSON.stringify(score, null, 2),
          target.name,
        );

        const matchIcon = score.overallVerdict ? chalk.green('PASS') : chalk.red('FAIL');
        judgeSpinner.succeed(
          `${tc.id}: Discovery ${score.apiDiscovery}%, Correctness ${score.callCorrectness}%, Complete ${score.completeness}%, Functional ${score.functionalCorrectness}% [${matchIcon}]`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        judgeSpinner.fail(`${tc.id}: Judge failed — ${message}`);

        await saveResult(paths, tc.id, 'judge-error.log', message, target.name);
      }
    }
  }

  console.log(chalk.dim(`\nResults saved to ${paths.results}`));
}
