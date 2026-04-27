import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectPaths, TestCase, JudgeScore, SolutionFile, TestResult, AggregateResults } from '../types.js';

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

    const judgeScore = await loadJsonFile<JudgeScore>(join(dir, 'judge.json'));
    const generatedSolution = await loadJsonFile<SolutionFile[]>(join(dir, 'generated-solution.json'));
    const agentNotes = await loadTextFile(join(dir, 'agent-notes.md'));

    results.push({
      testId: tc.id,
      difficulty: tc.difficulty,
      problemStatement: tc.problemStatement,
      judgeScore,
      generatedSolution,
      agentNotes,
    });
  }

  return results;
}

export function computeAggregates(testResults: TestResult[], target: string): AggregateResults {
  const withJudge = testResults.filter((r) => r.judgeScore !== null);

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

  const byDifficulty: AggregateResults['byDifficulty'] = {};
  for (const difficulty of ['easy', 'medium', 'hard'] as const) {
    const diffResults = testResults.filter((r) => r.difficulty === difficulty);
    const diffJudge = diffResults.filter((r) => r.judgeScore !== null);

    if (diffResults.length > 0) {
      byDifficulty[difficulty] = {
        count: diffResults.length,
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

  return {
    target,
    testResults,
    avgApiDiscovery,
    avgCallCorrectness,
    avgCompleteness,
    avgFunctionalCorrectness,
    passRate,
    byDifficulty,
  };
}
