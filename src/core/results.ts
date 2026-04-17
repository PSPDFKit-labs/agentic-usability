import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectPaths, TestCase, TokenAnalysis, JudgeScore, SolutionFile, TestResult, AggregateResults } from '../types.js';

export async function loadTextFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export async function loadJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function loadAllResults(paths: ProjectPaths, testCases: TestCase[], target: string): Promise<TestResult[]> {
  const results: TestResult[] = [];

  for (const tc of testCases) {
    const dir = join(paths.results, target, tc.id);

    const tokenAnalysis = await loadJsonFile<TokenAnalysis>(join(dir, 'token-analysis.json'));
    const judgeScore = await loadJsonFile<JudgeScore>(join(dir, 'judge.json'));
    const generatedSolution = await loadJsonFile<SolutionFile[]>(join(dir, 'generated-solution.json'));
    const agentNotes = await loadTextFile(join(dir, 'agent-notes.md'));

    results.push({
      testId: tc.id,
      difficulty: tc.difficulty,
      problemStatement: tc.problemStatement,
      targetApis: tc.targetApis,
      expectedTokens: tc.expectedTokens,
      tokenAnalysis,
      judgeScore,
      generatedSolution,
      agentNotes,
    });
  }

  return results;
}

export function computeAggregates(testResults: TestResult[], target: string): AggregateResults {
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
