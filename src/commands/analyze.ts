import chalk from 'chalk';
import ora from 'ora';
import { loadConfig, ensureWorkingDir } from '../core/config.js';
import { loadTestSuite, loadSolution, saveResult, RESULTS_DIR } from '../core/suite-io.js';
import { analyzeTokens } from '../scoring/tokens.js';
import { resolve } from 'node:path';

export async function analyzeCommand(): Promise<void> {
  const config = await loadConfig();
  await ensureWorkingDir();

  const spinner = ora('Loading test suite...').start();
  const testCases = await loadTestSuite(config);
  spinner.succeed(`Loaded ${testCases.length} test case(s)`);

  for (const target of config.targets) {
    console.log(chalk.bold(`\nAnalyzing solutions for target: ${target.name}\n`));

    for (const tc of testCases) {
      const solution = await loadSolution(tc.id, target.name);

      if (!solution) {
        console.log(
          chalk.yellow(`${tc.id}: No solution found — skipping (0% coverage)`),
        );

        const emptyAnalysis = analyzeTokens(
          [],
          tc.targetApis,
          tc.expectedTokens,
          tc.id,
          target.name,
        );

        await saveResult(
          tc.id,
          'token-analysis.json',
          JSON.stringify(emptyAnalysis, null, 2),
          target.name,
        );
        continue;
      }

      const analysis = analyzeTokens(
        solution,
        tc.targetApis,
        tc.expectedTokens,
        tc.id,
        target.name,
      );

      await saveResult(
        tc.id,
        'token-analysis.json',
        JSON.stringify(analysis, null, 2),
        target.name,
      );

      const apiTotal = tc.targetApis.length;
      const apiFound = analysis.apis.filter((a) => a.found).length;
      const tokenTotal = tc.expectedTokens.length;
      const tokenFound = analysis.tokens.filter((t) => t.found).length;

      console.log(
        `${tc.id}: API ${Math.round(analysis.apiCoverage)}% (${apiFound}/${apiTotal}), Tokens ${Math.round(analysis.tokenCoverage)}% (${tokenFound}/${tokenTotal})`,
      );
    }
  }

  console.log(chalk.dim(`\nResults saved to ${resolve(RESULTS_DIR)}`));
}
