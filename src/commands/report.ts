import chalk from 'chalk';
import Table from 'cli-table3';
import ora from 'ora';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { loadConfig, ensureWorkingDir } from '../core/config.js';
import type { Config, TestCase, TokenAnalysis, JudgeScore, SolutionFile } from '../core/types.js';

const DEFAULT_SUITE_FILE = '.agentic-usability/suite.json';
const RESULTS_DIR = '.agentic-usability/results';

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
  testResults: TestResult[];
  avgApiCoverage: number;
  avgTokenCoverage: number;
  avgSimilarity: number;
  byDifficulty: Record<string, { avgApiCoverage: number; avgTokenCoverage: number; avgSimilarity: number; count: number }>;
  worstApis: Array<{ api: string; missRate: number; missCount: number; totalCount: number }>;
  missedTokens: Array<{ token: string; missRate: number; missCount: number; totalCount: number }>;
}

async function loadTestSuite(config: Config): Promise<TestCase[]> {
  const suiteFile = resolve(config.output?.suiteFile ?? DEFAULT_SUITE_FILE);
  let raw: string;
  try {
    raw = await readFile(suiteFile, 'utf-8');
  } catch {
    throw new Error(
      `Test suite not found at ${suiteFile}. Run 'agentic-usability generate' first.`,
    );
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Test suite at ${suiteFile} is not a JSON array`);
  }
  return parsed as TestCase[];
}

async function loadJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function loadAllResults(testCases: TestCase[]): Promise<TestResult[]> {
  const results: TestResult[] = [];

  for (const tc of testCases) {
    const dir = resolve(join(RESULTS_DIR, tc.id));

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

function computeAggregates(testResults: TestResult[]): AggregateResults {
  const withAnalysis = testResults.filter((r) => r.tokenAnalysis !== null);
  const withJudge = testResults.filter((r) => r.judgeScore !== null);

  const avgApiCoverage = withAnalysis.length > 0
    ? withAnalysis.reduce((sum, r) => sum + r.tokenAnalysis!.apiCoverage, 0) / withAnalysis.length
    : 0;

  const avgTokenCoverage = withAnalysis.length > 0
    ? withAnalysis.reduce((sum, r) => sum + r.tokenAnalysis!.tokenCoverage, 0) / withAnalysis.length
    : 0;

  const avgSimilarity = withJudge.length > 0
    ? withJudge.reduce((sum, r) => sum + r.judgeScore!.overallSimilarity, 0) / withJudge.length
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
        avgSimilarity: diffJudge.length > 0
          ? diffJudge.reduce((sum, r) => sum + r.judgeScore!.overallSimilarity, 0) / diffJudge.length
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
    testResults,
    avgApiCoverage,
    avgTokenCoverage,
    avgSimilarity,
    byDifficulty,
    worstApis,
    missedTokens,
  };
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function printScorecard(aggregates: AggregateResults): void {
  // Main results table
  const table = new Table({
    head: [
      chalk.cyan('Test ID'),
      chalk.cyan('Difficulty'),
      chalk.cyan('API Cov.'),
      chalk.cyan('Token Cov.'),
      chalk.cyan('Similarity'),
      chalk.cyan('Problem'),
    ],
  });

  for (const r of aggregates.testResults) {
    const apiCov = r.tokenAnalysis ? formatPercent(r.tokenAnalysis.apiCoverage) : chalk.dim('N/A');
    const tokenCov = r.tokenAnalysis ? formatPercent(r.tokenAnalysis.tokenCoverage) : chalk.dim('N/A');
    const similarity = r.judgeScore ? formatPercent(r.judgeScore.overallSimilarity) : chalk.dim('N/A');
    const problem = r.problemStatement.length > 50
      ? r.problemStatement.slice(0, 47) + '...'
      : r.problemStatement;

    table.push([r.testId, r.difficulty, apiCov, tokenCov, similarity, problem]);
  }

  console.log(chalk.bold('\nScorecard\n'));
  console.log(table.toString());

  // Aggregates
  console.log(chalk.bold('\nAggregates'));
  console.log(`  Average API Coverage:   ${formatPercent(aggregates.avgApiCoverage)}`);
  console.log(`  Average Token Coverage: ${formatPercent(aggregates.avgTokenCoverage)}`);
  console.log(`  Average Similarity:     ${formatPercent(aggregates.avgSimilarity)}`);

  // Breakdown by difficulty
  if (Object.keys(aggregates.byDifficulty).length > 0) {
    console.log(chalk.bold('\nBy Difficulty'));
    const diffTable = new Table({
      head: [
        chalk.cyan('Difficulty'),
        chalk.cyan('Count'),
        chalk.cyan('Avg API Cov.'),
        chalk.cyan('Avg Token Cov.'),
        chalk.cyan('Avg Similarity'),
      ],
    });
    for (const [difficulty, stats] of Object.entries(aggregates.byDifficulty)) {
      diffTable.push([
        difficulty,
        stats.count.toString(),
        formatPercent(stats.avgApiCoverage),
        formatPercent(stats.avgTokenCoverage),
        formatPercent(stats.avgSimilarity),
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

function buildJsonOutput(aggregates: AggregateResults): object {
  return {
    testResults: aggregates.testResults.map((r) => ({
      testId: r.testId,
      difficulty: r.difficulty,
      problemStatement: r.problemStatement,
      tokenAnalysis: r.tokenAnalysis,
      judgeScore: r.judgeScore,
      generatedSolution: r.generatedSolution,
    })),
    aggregates: {
      avgApiCoverage: aggregates.avgApiCoverage,
      avgTokenCoverage: aggregates.avgTokenCoverage,
      avgSimilarity: aggregates.avgSimilarity,
      byDifficulty: aggregates.byDifficulty,
    },
    worstApis: aggregates.worstApis,
    missedTokens: aggregates.missedTokens,
  };
}

export async function reportCommand(options: { json?: boolean } = {}): Promise<void> {
  const config = await loadConfig();
  await ensureWorkingDir();

  const spinner = ora('Loading test suite and results...').start();
  const testCases = await loadTestSuite(config);
  const testResults = await loadAllResults(testCases);
  spinner.succeed(`Loaded results for ${testCases.length} test case(s)`);

  const aggregates = computeAggregates(testResults);

  if (options.json) {
    const output = buildJsonOutput(aggregates);
    console.log(JSON.stringify(output, null, 2));
  } else {
    printScorecard(aggregates);
  }
}

export async function exportResultsCommand(options: { output: string }): Promise<void> {
  const config = await loadConfig();
  await ensureWorkingDir();

  const spinner = ora('Loading test suite and results...').start();
  const testCases = await loadTestSuite(config);
  const testResults = await loadAllResults(testCases);
  spinner.succeed(`Loaded results for ${testCases.length} test case(s)`);

  const aggregates = computeAggregates(testResults);
  const output = buildJsonOutput(aggregates);
  const outputPath = resolve(options.output);

  await writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(chalk.green(`Results exported to ${outputPath}`));
}
