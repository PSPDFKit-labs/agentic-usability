import chalk from 'chalk';
import Table from 'cli-table3';
import ora from 'ora';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../core/config.js';
import { loadTestSuite } from '../core/suite-io.js';
import type { AggregateResults, ProjectPaths } from '../types.js';
import { loadAllResults, computeAggregates } from '../core/results.js';

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function printScorecard(aggregates: AggregateResults): void {
  console.log(chalk.bold(`\nScorecard — ${aggregates.target}\n`));

  const table = new Table({
    head: [
      chalk.cyan('Test ID'),
      chalk.cyan('Diff.'),
      chalk.cyan('Discovery'),
      chalk.cyan('Correct.'),
      chalk.cyan('Complete.'),
      chalk.cyan('Func.'),
      chalk.cyan('Verdict'),
    ],
  });

  for (const r of aggregates.testResults) {
    const discovery = r.judgeScore ? formatPercent(r.judgeScore.apiDiscovery) : chalk.dim('N/A');
    const correctness = r.judgeScore ? formatPercent(r.judgeScore.callCorrectness) : chalk.dim('N/A');
    const completeness = r.judgeScore ? formatPercent(r.judgeScore.completeness) : chalk.dim('N/A');
    const functional = r.judgeScore ? formatPercent(r.judgeScore.functionalCorrectness) : chalk.dim('N/A');
    const verdict = r.judgeScore
      ? (r.judgeScore.overallVerdict ? chalk.green('PASS') : chalk.red('FAIL'))
      : chalk.dim('N/A');

    table.push([r.testId, r.difficulty, discovery, correctness, completeness, functional, verdict]);
  }

  console.log(table.toString());

  console.log(chalk.bold('\nAggregates'));
  console.log(`  API Discovery:         ${formatPercent(aggregates.avgApiDiscovery)}`);
  console.log(`  Call Correctness:      ${formatPercent(aggregates.avgCallCorrectness)}`);
  console.log(`  Completeness:          ${formatPercent(aggregates.avgCompleteness)}`);
  console.log(`  Functional Correct.:   ${formatPercent(aggregates.avgFunctionalCorrectness)}`);
  console.log(`  Pass Rate:             ${formatPercent(aggregates.passRate)}`);

  if (Object.keys(aggregates.byDifficulty).length > 0) {
    console.log(chalk.bold('\nBy Difficulty'));
    const diffTable = new Table({
      head: [
        chalk.cyan('Difficulty'),
        chalk.cyan('Count'),
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
        formatPercent(stats.avgApiDiscovery),
        formatPercent(stats.avgCallCorrectness),
        formatPercent(stats.avgCompleteness),
        formatPercent(stats.avgFunctionalCorrectness),
        formatPercent(stats.passRate),
      ]);
    }
    console.log(diffTable.toString());
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
        judgeScore: r.judgeScore,
        generatedSolution: r.generatedSolution,
      })),
      aggregates: {
        avgApiDiscovery: agg.avgApiDiscovery,
        avgCallCorrectness: agg.avgCallCorrectness,
        avgCompleteness: agg.avgCompleteness,
        avgFunctionalCorrectness: agg.avgFunctionalCorrectness,
        passRate: agg.passRate,
        byDifficulty: agg.byDifficulty,
      },
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

  const output = buildJsonOutput(allAggregates);
  const reportPath = join(paths.results, 'report.json');
  await writeFile(reportPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(chalk.dim(`\nReport saved to ${reportPath}`));
}
