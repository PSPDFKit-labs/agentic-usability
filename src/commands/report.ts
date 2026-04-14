import chalk from 'chalk';
import Table from 'cli-table3';
import ora from 'ora';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { loadConfig } from '../core/config.js';
import { loadTestSuite } from '../core/suite-io.js';
import type { ProjectPaths } from '../core/paths.js';
import type { Config, TestCase, TokenAnalysis, JudgeScore, SolutionFile } from '../core/types.js';

interface TestResult {
  testId: string;
  difficulty: 'easy' | 'medium' | 'hard';
  problemStatement: string;
  targetApis: string[];
  expectedTokens: string[];
  tokenAnalysis: TokenAnalysis | null;
  judgeScore: JudgeScore | null;
  generatedSolution: SolutionFile[] | null;
}

interface AggregateResults {
  target: string;
  testResults: TestResult[];
  avgApiCoverage: number;
  avgTokenCoverage: number;
  avgApiDiscovery: number;
  avgCallCorrectness: number;
  avgCompleteness: number;
  avgFunctionalCorrectness: number;
  passRate: number;
  byDifficulty: Record<string, { avgApiCoverage: number; avgTokenCoverage: number; avgApiDiscovery: number; avgCallCorrectness: number; avgCompleteness: number; avgFunctionalCorrectness: number; passRate: number; count: number }>;
  worstApis: Array<{ api: string; missRate: number; missCount: number; totalCount: number }>;
  missedTokens: Array<{ token: string; missRate: number; missCount: number; totalCount: number }>;
}

async function loadJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function loadAllResults(paths: ProjectPaths, testCases: TestCase[], target: string): Promise<TestResult[]> {
  const results: TestResult[] = [];

  for (const tc of testCases) {
    const dir = join(paths.results, target, tc.id);

    const tokenAnalysis = await loadJsonFile<TokenAnalysis>(join(dir, 'token-analysis.json'));
    const judgeScore = await loadJsonFile<JudgeScore>(join(dir, 'judge.json'));
    const generatedSolution = await loadJsonFile<SolutionFile[]>(join(dir, 'generated-solution.json'));

    results.push({
      testId: tc.id,
      difficulty: tc.difficulty,
      problemStatement: tc.problemStatement,
      targetApis: tc.targetApis,
      expectedTokens: tc.expectedTokens,
      tokenAnalysis,
      judgeScore,
      generatedSolution,
    });
  }

  return results;
}

function computeAggregates(testResults: TestResult[], target: string): AggregateResults {
  const withAnalysis = testResults.filter((r) => r.tokenAnalysis !== null);
  const withJudge = testResults.filter((r) => r.judgeScore !== null);

  const avgApiCoverage = withAnalysis.length > 0
    ? withAnalysis.reduce((sum, r) => sum + r.tokenAnalysis!.apiCoverage, 0) / withAnalysis.length
    : 0;

  const avgTokenCoverage = withAnalysis.length > 0
    ? withAnalysis.reduce((sum, r) => sum + r.tokenAnalysis!.tokenCoverage, 0) / withAnalysis.length
    : 0;

  const avgApiDiscovery = withJudge.length > 0
    ? withJudge.reduce((sum, r) => sum + r.judgeScore!.apiDiscovery, 0) / withJudge.length
    : 0;

  const avgCallCorrectness = withJudge.length > 0
    ? withJudge.reduce((sum, r) => sum + r.judgeScore!.callCorrectness, 0) / withJudge.length
    : 0;

  const avgCompleteness = withJudge.length > 0
    ? withJudge.reduce((sum, r) => sum + r.judgeScore!.completeness, 0) / withJudge.length
    : 0;

  const avgFunctionalCorrectness = withJudge.length > 0
    ? withJudge.reduce((sum, r) => sum + r.judgeScore!.functionalCorrectness, 0) / withJudge.length
    : 0;

  const passRate = withJudge.length > 0
    ? (withJudge.filter((r) => r.judgeScore!.overallVerdict).length / withJudge.length) * 100
    : 0;

  // Breakdown by difficulty
  const byDifficulty: AggregateResults['byDifficulty'] = {};
  for (const difficulty of ['easy', 'medium', 'hard'] as const) {
    const diffResults = testResults.filter((r) => r.difficulty === difficulty);
    const diffAnalysis = diffResults.filter((r) => r.tokenAnalysis !== null);
    const diffJudge = diffResults.filter((r) => r.judgeScore !== null);

    if (diffResults.length > 0) {
      byDifficulty[difficulty] = {
        count: diffResults.length,
        avgApiCoverage: diffAnalysis.length > 0
          ? diffAnalysis.reduce((sum, r) => sum + r.tokenAnalysis!.apiCoverage, 0) / diffAnalysis.length
          : 0,
        avgTokenCoverage: diffAnalysis.length > 0
          ? diffAnalysis.reduce((sum, r) => sum + r.tokenAnalysis!.tokenCoverage, 0) / diffAnalysis.length
          : 0,
        avgApiDiscovery: diffJudge.length > 0
          ? diffJudge.reduce((sum, r) => sum + r.judgeScore!.apiDiscovery, 0) / diffJudge.length
          : 0,
        avgCallCorrectness: diffJudge.length > 0
          ? diffJudge.reduce((sum, r) => sum + r.judgeScore!.callCorrectness, 0) / diffJudge.length
          : 0,
        avgCompleteness: diffJudge.length > 0
          ? diffJudge.reduce((sum, r) => sum + r.judgeScore!.completeness, 0) / diffJudge.length
          : 0,
        avgFunctionalCorrectness: diffJudge.length > 0
          ? diffJudge.reduce((sum, r) => sum + r.judgeScore!.functionalCorrectness, 0) / diffJudge.length
          : 0,
        passRate: diffJudge.length > 0
          ? (diffJudge.filter((r) => r.judgeScore!.overallVerdict).length / diffJudge.length) * 100
          : 0,
      };
    }
  }

  // Worst performing APIs
  const apiStats = new Map<string, { missed: number; total: number }>();
  for (const r of testResults) {
    if (!r.tokenAnalysis) continue;
    for (const api of r.tokenAnalysis.apis) {
      const stat = apiStats.get(api.token) ?? { missed: 0, total: 0 };
      stat.total++;
      if (!api.found) stat.missed++;
      apiStats.set(api.token, stat);
    }
  }

  const worstApis = Array.from(apiStats.entries())
    .filter(([, stat]) => stat.missed > 0)
    .map(([api, stat]) => ({
      api,
      missRate: (stat.missed / stat.total) * 100,
      missCount: stat.missed,
      totalCount: stat.total,
    }))
    .sort((a, b) => b.missRate - a.missRate);

  // Missed tokens
  const tokenStats = new Map<string, { missed: number; total: number }>();
  for (const r of testResults) {
    if (!r.tokenAnalysis) continue;
    for (const t of r.tokenAnalysis.tokens) {
      const stat = tokenStats.get(t.token) ?? { missed: 0, total: 0 };
      stat.total++;
      if (!t.found) stat.missed++;
      tokenStats.set(t.token, stat);
    }
  }

  const missedTokens = Array.from(tokenStats.entries())
    .filter(([, stat]) => stat.missed > 0)
    .map(([token, stat]) => ({
      token,
      missRate: (stat.missed / stat.total) * 100,
      missCount: stat.missed,
      totalCount: stat.total,
    }))
    .sort((a, b) => b.missRate - a.missRate);

  return {
    target,
    testResults,
    avgApiCoverage,
    avgTokenCoverage,
    avgApiDiscovery,
    avgCallCorrectness,
    avgCompleteness,
    avgFunctionalCorrectness,
    passRate,
    byDifficulty,
    worstApis,
    missedTokens,
  };
}

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
