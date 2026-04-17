import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../core/config.js';
import { loadTestSuite, loadSolution, saveResult } from '../core/suite-io.js';
import { analyzeTokens } from '../scoring/tokens.js';
import type { Config, TestCase, ProjectPaths } from '../types.js';

/**
 * Core analyze stage: run token analysis for each test case across all targets.
 * Used by both `analyzeCommand` (standalone) and `evalCommand` (pipeline).
 */
export async function runAnalyzeStage(opts: {
  config: Config;
  paths: ProjectPaths;
  testCases: TestCase[];
  filterForTarget?: (testCases: TestCase[], targetName: string) => TestCase[];
  onTestComplete?: (testId: string, target: string) => void;
}): Promise<void> {
  const { config, paths, testCases, filterForTarget, onTestComplete } = opts;

  for (const target of config.targets) {
    const targetTests = filterForTarget ? filterForTarget(testCases, target.name) : testCases;
    if (targetTests.length === 0) {
      console.log(chalk.dim(`\nTarget: ${target.name} — all tests already analyzed`));
      continue;
    }

    console.log(chalk.bold(`\nAnalyzing solutions for target: ${target.name}\n`));

    for (const tc of targetTests) {
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
        onTestComplete?.(tc.id, target.name);
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
        `  ${tc.id}: API ${Math.round(analysis.apiCoverage)}% (${apiFound}/${apiTotal}), Tokens ${Math.round(analysis.tokenCoverage)}% (${tokenFound}/${tokenTotal})`,
      );
      onTestComplete?.(tc.id, target.name);
    }
  }
}

export async function analyzeCommand(paths: ProjectPaths, options: { testIds?: string[] } = {}): Promise<void> {
  const config = await loadConfig(paths.config);

  const spinner = ora('Loading test suite...').start();
  const allTestCases = await loadTestSuite(paths);
  const testCases = options.testIds
    ? allTestCases.filter(tc => options.testIds!.includes(tc.id))
    : allTestCases;
  spinner.succeed(`Loaded ${testCases.length} test case(s)${options.testIds ? ` (filtered from ${allTestCases.length})` : ''}`);

  await runAnalyzeStage({ config, paths, testCases });

  console.log(chalk.dim(`\nResults saved to ${paths.results}`));
}
