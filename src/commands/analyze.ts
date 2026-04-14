import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../core/config.js';
import { loadTestSuite, loadSolution, saveResult } from '../core/suite-io.js';
import { analyzeTokens } from '../scoring/tokens.js';
import type { ProjectPaths } from '../core/paths.js';

export async function analyzeCommand(paths: ProjectPaths): Promise<void> {
  const config = await loadConfig(paths.config);

  const spinner = ora('Loading test suite...').start();
  const testCases = await loadTestSuite(paths);
  spinner.succeed(`Loaded ${testCases.length} test case(s)`);

  for (const target of config.targets) {
    console.log(chalk.bold(`\nAnalyzing solutions for target: ${target.name}\n`));

    for (const tc of testCases) {
      const solution = await loadSolution(paths, tc.id, target.name);

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
          paths,
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
        paths,
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

  console.log(chalk.dim(`\nResults saved to ${paths.results}`));
}
