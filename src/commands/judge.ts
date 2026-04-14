import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../core/config.js';
import { loadTestSuite, loadSolution, saveResult } from '../core/suite-io.js';
import { runJudge } from '../scoring/judge.js';
import type { ProjectPaths } from '../core/paths.js';

export async function judgeCommand(paths: ProjectPaths, options: { skipJudge?: boolean } = {}): Promise<void> {
  if (options.skipJudge) {
    console.log(chalk.yellow('Judge stage skipped (--skip-judge flag)'));
    return;
  }

  const config = await loadConfig(paths.config);

  const spinner = ora('Loading test suite...').start();
  const testCases = await loadTestSuite(paths);
  spinner.succeed(`Loaded ${testCases.length} test case(s)`);

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

      const judgeSpinner = ora(`${tc.id}: Running judge...`).start();

      try {
        const score = await runJudge(tc, solution, judgeConfig, target.name);

        await saveResult(
          paths,
          tc.id,
          'judge.json',
          JSON.stringify(score, null, 2),
          target.name,
        );

        const matchIcon = score.functionalMatch ? chalk.green('MATCH') : chalk.red('NO MATCH');
        judgeSpinner.succeed(
          `${tc.id}: Similarity ${score.overallSimilarity}%, API ${score.apiCorrectness}%, Idiomatic ${score.idiomaticUsage}% [${matchIcon}]`,
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
