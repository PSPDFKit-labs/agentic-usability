import chalk from 'chalk';
import Table from 'cli-table3';
import ora from 'ora';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig } from '../core/config.js';
import { loadTestSuite } from '../core/suite-io.js';
import type { ProjectPaths } from '../core/paths.js';
import { type AggregateResults, loadAllResults, computeAggregates } from '../core/results.js';

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function printScorecard(aggregates: AggregateResults): void {
  console.log(chalk.bold(`\nScorecard — ${aggregates.target}\n`));

  // Main results table
  const table = new Table({
    head: [
      chalk.cyan('Test ID'),
      chalk.cyan('Diff.'),
      chalk.cyan('API Cov.'),
      chalk.cyan('Token Cov.'),
      chalk.cyan('Discovery'),
      chalk.cyan('Correct.'),
      chalk.cyan('Complete.'),
      chalk.cyan('Func.'),
      chalk.cyan('Verdict'),
    ],
  });

  for (const r of aggregates.testResults) {
    const apiCov = r.tokenAnalysis ? formatPercent(r.tokenAnalysis.apiCoverage) : chalk.dim('N/A');
    const tokenCov = r.tokenAnalysis ? formatPercent(r.tokenAnalysis.tokenCoverage) : chalk.dim('N/A');
    const discovery = r.judgeScore ? formatPercent(r.judgeScore.apiDiscovery) : chalk.dim('N/A');
    const correctness = r.judgeScore ? formatPercent(r.judgeScore.callCorrectness) : chalk.dim('N/A');
    const completeness = r.judgeScore ? formatPercent(r.judgeScore.completeness) : chalk.dim('N/A');
    const functional = r.judgeScore ? formatPercent(r.judgeScore.functionalCorrectness) : chalk.dim('N/A');
    const verdict = r.judgeScore
      ? (r.judgeScore.overallVerdict ? chalk.green('PASS') : chalk.red('FAIL'))
      : chalk.dim('N/A');

    table.push([r.testId, r.difficulty, apiCov, tokenCov, discovery, correctness, completeness, functional, verdict]);
  }

  console.log(table.toString());

  // Aggregates
  console.log(chalk.bold('\nAggregates'));
  console.log(`  API Coverage:          ${formatPercent(aggregates.avgApiCoverage)}`);
  console.log(`  Token Coverage:        ${formatPercent(aggregates.avgTokenCoverage)}`);
  console.log(`  API Discovery:         ${formatPercent(aggregates.avgApiDiscovery)}`);
  console.log(`  Call Correctness:      ${formatPercent(aggregates.avgCallCorrectness)}`);
  console.log(`  Completeness:          ${formatPercent(aggregates.avgCompleteness)}`);
  console.log(`  Functional Correct.:   ${formatPercent(aggregates.avgFunctionalCorrectness)}`);
  console.log(`  Pass Rate:             ${formatPercent(aggregates.passRate)}`);

  // Breakdown by difficulty
  if (Object.keys(aggregates.byDifficulty).length > 0) {
    console.log(chalk.bold('\nBy Difficulty'));
    const diffTable = new Table({
      head: [
        chalk.cyan('Difficulty'),
        chalk.cyan('Count'),
        chalk.cyan('API Cov.'),
        chalk.cyan('Token Cov.'),
        chalk.cyan('Discovery'),
        chalk.cyan('Correct.'),
        chalk.cyan('Complete.'),
        chalk.cyan('Func.'),
        chalk.cyan('Pass Rate'),
      ],
    });
    for (const [difficulty, stats] of Object.entries(aggregates.byDifficulty)) {
      diffTable.push([
        difficulty,
        stats.count.toString(),
        formatPercent(stats.avgApiCoverage),
        formatPercent(stats.avgTokenCoverage),
        formatPercent(stats.avgApiDiscovery),
        formatPercent(stats.avgCallCorrectness),
        formatPercent(stats.avgCompleteness),
        formatPercent(stats.avgFunctionalCorrectness),
        formatPercent(stats.passRate),
      ]);
    }
    console.log(diffTable.toString());
  }

  // Worst performing APIs
  if (aggregates.worstApis.length > 0) {
    console.log(chalk.bold('\nWorst Performing APIs'));
    const apiTable = new Table({
      head: [chalk.cyan('API'), chalk.cyan('Miss Rate'), chalk.cyan('Missed/Total')],
    });
    for (const api of aggregates.worstApis) {
      apiTable.push([api.api, formatPercent(api.missRate), `${api.missCount}/${api.totalCount}`]);
    }
    console.log(apiTable.toString());
  }

  // Missed tokens
  if (aggregates.missedTokens.length > 0) {
    console.log(chalk.bold('\nMissed Tokens'));
    const tokenTable = new Table({
      head: [chalk.cyan('Token'), chalk.cyan('Miss Rate'), chalk.cyan('Missed/Total')],
    });
    for (const t of aggregates.missedTokens) {
      tokenTable.push([t.token, formatPercent(t.missRate), `${t.missCount}/${t.totalCount}`]);
    }
    console.log(tokenTable.toString());
  }
}

function buildJsonOutput(allAggregates: AggregateResults[]): object {
  return {
    targets: allAggregates.map((agg) => ({
      target: agg.target,
      testResults: agg.testResults.map((r) => ({
        testId: r.testId,
        difficulty: r.difficulty,
        problemStatement: r.problemStatement,
        tokenAnalysis: r.tokenAnalysis,
        judgeScore: r.judgeScore,
        generatedSolution: r.generatedSolution,
      })),
      aggregates: {
        avgApiCoverage: agg.avgApiCoverage,
        avgTokenCoverage: agg.avgTokenCoverage,
        avgApiDiscovery: agg.avgApiDiscovery,
        avgCallCorrectness: agg.avgCallCorrectness,
        avgCompleteness: agg.avgCompleteness,
        avgFunctionalCorrectness: agg.avgFunctionalCorrectness,
        passRate: agg.passRate,
        byDifficulty: agg.byDifficulty,
      },
      worstApis: agg.worstApis,
      missedTokens: agg.missedTokens,
    })),
  };
}

export async function reportCommand(paths: ProjectPaths, options: { json?: boolean } = {}): Promise<void> {
  const config = await loadConfig(paths.config);

  const spinner = ora('Loading test suite and results...').start();
  const testCases = await loadTestSuite(paths);
  spinner.succeed(`Loaded ${testCases.length} test case(s)`);

  const allAggregates: AggregateResults[] = [];

  for (const target of config.targets) {
    const testResults = await loadAllResults(paths, testCases, target.name);
    const aggregates = computeAggregates(testResults, target.name);
    allAggregates.push(aggregates);

    if (!options.json) {
      printScorecard(aggregates);
    }
  }

  if (options.json) {
    const output = buildJsonOutput(allAggregates);
    console.log(JSON.stringify(output, null, 2));
  }
}

export async function exportResultsCommand(paths: ProjectPaths, options: { output: string }): Promise<void> {
  const config = await loadConfig(paths.config);

  const spinner = ora('Loading test suite and results...').start();
  const testCases = await loadTestSuite(paths);
  spinner.succeed(`Loaded ${testCases.length} test case(s)`);

  const allAggregates: AggregateResults[] = [];

  for (const target of config.targets) {
    const testResults = await loadAllResults(paths, testCases, target.name);
    const aggregates = computeAggregates(testResults, target.name);
    allAggregates.push(aggregates);
  }

  const output = buildJsonOutput(allAggregates);
  const outputPath = resolve(options.output);

  await writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(chalk.green(`Results exported to ${outputPath}`));
}
