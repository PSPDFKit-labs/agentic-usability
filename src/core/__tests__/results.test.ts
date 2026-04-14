import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { loadJsonFile, computeAggregates, loadAllResults } from '../results.js';
import type { TestResult } from '../results.js';
import { makeTestCase, makeProjectPaths } from '../../__tests__/helpers/fixtures.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

const mockReadFile = vi.mocked(readFile);

// ---------------------------------------------------------------------------
// loadJsonFile
// ---------------------------------------------------------------------------

describe('loadJsonFile', () => {
  beforeEach(() => {
    mockReadFile.mockReset();
  });

  it('returns parsed JSON on success', async () => {
    const data = { foo: 'bar', count: 42 };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(data) as any);

    const result = await loadJsonFile<typeof data>('/fake/file.json');
    expect(result).toEqual(data);
    expect(mockReadFile).toHaveBeenCalledWith('/fake/file.json', 'utf-8');
  });

  it('returns null on file not found (ENOENT)', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReadFile.mockRejectedValueOnce(err);

    const result = await loadJsonFile('/fake/missing.json');
    expect(result).toBeNull();
  });

  it('returns null on invalid JSON', async () => {
    mockReadFile.mockResolvedValueOnce('not valid json {{{' as any);

    const result = await loadJsonFile('/fake/bad.json');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Helpers for building TestResult fixtures
// ---------------------------------------------------------------------------

function makeTestResult(overrides: Partial<TestResult> = {}): TestResult {
  return {
    testId: 'TC-001',
    difficulty: 'easy',
    problemStatement: 'test',
    targetApis: ['apiA'],
    expectedTokens: ['token1'],
    tokenAnalysis: {
      testId: 'TC-001',
      target: 't',
      apis: [{ token: 'apiA', found: true }],
      tokens: [{ token: 'token1', found: true }],
      apiCoverage: 100,
      tokenCoverage: 100,
    },
    judgeScore: {
      testId: 'TC-001',
      target: 't',
      apiDiscovery: 90,
      callCorrectness: 85,
      completeness: 80,
      functionalCorrectness: 88,
      overallVerdict: true,
      notes: 'good',
    },
    generatedSolution: [{ path: 'a.ts', content: 'code' }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeAggregates
// ---------------------------------------------------------------------------

describe('computeAggregates', () => {
  it('normal case with both analysis and judge data returns correct averages', () => {
    const r1 = makeTestResult({
      testId: 'TC-001',
      tokenAnalysis: {
        testId: 'TC-001', target: 't',
        apis: [{ token: 'apiA', found: true }],
        tokens: [{ token: 'tok1', found: true }],
        apiCoverage: 80,
        tokenCoverage: 70,
      },
      judgeScore: {
        testId: 'TC-001', target: 't',
        apiDiscovery: 60, callCorrectness: 70,
        completeness: 80, functionalCorrectness: 90,
        overallVerdict: true, notes: '',
      },
    });

    const r2 = makeTestResult({
      testId: 'TC-002',
      tokenAnalysis: {
        testId: 'TC-002', target: 't',
        apis: [{ token: 'apiB', found: true }],
        tokens: [{ token: 'tok2', found: true }],
        apiCoverage: 60,
        tokenCoverage: 50,
      },
      judgeScore: {
        testId: 'TC-002', target: 't',
        apiDiscovery: 40, callCorrectness: 50,
        completeness: 60, functionalCorrectness: 70,
        overallVerdict: false, notes: '',
      },
    });

    const agg = computeAggregates([r1, r2], 'my-target');

    expect(agg.target).toBe('my-target');
    expect(agg.avgApiCoverage).toBe(70);      // (80+60)/2
    expect(agg.avgTokenCoverage).toBe(60);    // (70+50)/2
    expect(agg.avgApiDiscovery).toBe(50);     // (60+40)/2
    expect(agg.avgCallCorrectness).toBe(60);  // (70+50)/2
    expect(agg.avgCompleteness).toBe(70);     // (80+60)/2
    expect(agg.avgFunctionalCorrectness).toBe(80); // (90+70)/2
  });

  it('empty test results yields all zeros', () => {
    const agg = computeAggregates([], 'target');

    expect(agg.avgApiCoverage).toBe(0);
    expect(agg.avgTokenCoverage).toBe(0);
    expect(agg.avgApiDiscovery).toBe(0);
    expect(agg.avgCallCorrectness).toBe(0);
    expect(agg.avgCompleteness).toBe(0);
    expect(agg.avgFunctionalCorrectness).toBe(0);
    expect(agg.passRate).toBe(0);
    expect(agg.worstApis).toEqual([]);
    expect(agg.missedTokens).toEqual([]);
  });

  it('results with no judge data give judge averages of 0 and passRate of 0', () => {
    const r = makeTestResult({ judgeScore: null });
    const agg = computeAggregates([r], 'target');

    expect(agg.avgApiDiscovery).toBe(0);
    expect(agg.avgCallCorrectness).toBe(0);
    expect(agg.avgCompleteness).toBe(0);
    expect(agg.avgFunctionalCorrectness).toBe(0);
    expect(agg.passRate).toBe(0);
    // token analysis is present so coverage is non-zero
    expect(agg.avgApiCoverage).toBe(100);
    expect(agg.avgTokenCoverage).toBe(100);
  });

  it('by-difficulty breakdown has correct counts and averages', () => {
    const easy = makeTestResult({
      testId: 'TC-E', difficulty: 'easy',
      tokenAnalysis: {
        testId: 'TC-E', target: 't',
        apis: [], tokens: [],
        apiCoverage: 80, tokenCoverage: 60,
      },
      judgeScore: null,
    });

    const medium = makeTestResult({
      testId: 'TC-M', difficulty: 'medium',
      tokenAnalysis: {
        testId: 'TC-M', target: 't',
        apis: [], tokens: [],
        apiCoverage: 50, tokenCoverage: 40,
      },
      judgeScore: null,
    });

    const hard = makeTestResult({
      testId: 'TC-H', difficulty: 'hard',
      tokenAnalysis: {
        testId: 'TC-H', target: 't',
        apis: [], tokens: [],
        apiCoverage: 20, tokenCoverage: 10,
      },
      judgeScore: null,
    });

    const agg = computeAggregates([easy, medium, hard], 'target');

    expect(agg.byDifficulty['easy'].count).toBe(1);
    expect(agg.byDifficulty['easy'].avgApiCoverage).toBe(80);
    expect(agg.byDifficulty['medium'].count).toBe(1);
    expect(agg.byDifficulty['medium'].avgApiCoverage).toBe(50);
    expect(agg.byDifficulty['hard'].count).toBe(1);
    expect(agg.byDifficulty['hard'].avgApiCoverage).toBe(20);
  });

  it('worstApis: APIs with misses are sorted by miss rate descending', () => {
    const r1 = makeTestResult({
      testId: 'TC-001',
      tokenAnalysis: {
        testId: 'TC-001', target: 't',
        apis: [
          { token: 'apiA', found: false },
          { token: 'apiB', found: true },
        ],
        tokens: [],
        apiCoverage: 50, tokenCoverage: 100,
      },
      judgeScore: null,
    });

    const r2 = makeTestResult({
      testId: 'TC-002',
      tokenAnalysis: {
        testId: 'TC-002', target: 't',
        apis: [
          { token: 'apiA', found: false },  // apiA: 2 misses / 2 total = 100%
          { token: 'apiB', found: false },  // apiB: 1 miss / 2 total = 50%
        ],
        tokens: [],
        apiCoverage: 0, tokenCoverage: 100,
      },
      judgeScore: null,
    });

    const agg = computeAggregates([r1, r2], 'target');

    expect(agg.worstApis.length).toBeGreaterThanOrEqual(2);
    // apiA has 100% miss rate, apiB has 50% — apiA should come first
    expect(agg.worstApis[0].api).toBe('apiA');
    expect(agg.worstApis[0].missRate).toBe(100);
    expect(agg.worstApis[0].missCount).toBe(2);
    expect(agg.worstApis[0].totalCount).toBe(2);
    expect(agg.worstApis[1].api).toBe('apiB');
    expect(agg.worstApis[1].missRate).toBe(50);
  });

  it('missedTokens: tokens with misses sorted by miss rate descending', () => {
    const r = makeTestResult({
      testId: 'TC-001',
      tokenAnalysis: {
        testId: 'TC-001', target: 't',
        apis: [],
        tokens: [
          { token: 'tok1', found: false },
          { token: 'tok2', found: true },
        ],
        apiCoverage: 100, tokenCoverage: 50,
      },
      judgeScore: null,
    });

    const agg = computeAggregates([r], 'target');

    expect(agg.missedTokens).toHaveLength(1);
    expect(agg.missedTokens[0].token).toBe('tok1');
    expect(agg.missedTokens[0].missRate).toBe(100);
    expect(agg.missedTokens[0].missCount).toBe(1);
    expect(agg.missedTokens[0].totalCount).toBe(1);
  });

  it('pass rate: 2 pass + 1 fail = 66.67%', () => {
    const pass1 = makeTestResult({
      testId: 'TC-001',
      judgeScore: { testId: 'TC-001', target: 't', apiDiscovery: 90, callCorrectness: 90, completeness: 90, functionalCorrectness: 90, overallVerdict: true, notes: '' },
    });
    const pass2 = makeTestResult({
      testId: 'TC-002',
      judgeScore: { testId: 'TC-002', target: 't', apiDiscovery: 80, callCorrectness: 80, completeness: 80, functionalCorrectness: 80, overallVerdict: true, notes: '' },
    });
    const fail1 = makeTestResult({
      testId: 'TC-003',
      judgeScore: { testId: 'TC-003', target: 't', apiDiscovery: 40, callCorrectness: 40, completeness: 40, functionalCorrectness: 40, overallVerdict: false, notes: '' },
    });

    const agg = computeAggregates([pass1, pass2, fail1], 'target');

    expect(agg.passRate).toBeCloseTo(66.67, 1);
  });
});

// ---------------------------------------------------------------------------
// loadAllResults
// ---------------------------------------------------------------------------

describe('loadAllResults', () => {
  beforeEach(() => {
    mockReadFile.mockReset();
  });

  it('loads results for all test cases, joining analysis, judge, and solution', async () => {
    const paths = makeProjectPaths();
    const tc = makeTestCase({ id: 'TC-001', difficulty: 'easy' });

    const tokenAnalysis = {
      testId: 'TC-001', target: 'claude',
      apis: [{ token: 'add', found: true }],
      tokens: [{ token: 'export', found: true }],
      apiCoverage: 100, tokenCoverage: 100,
    };
    const judgeScore = {
      testId: 'TC-001', target: 'claude',
      apiDiscovery: 90, callCorrectness: 85,
      completeness: 80, functionalCorrectness: 88,
      overallVerdict: true, notes: 'ok',
    };
    const solution = [{ path: 'solution.ts', content: 'code' }];

    // token-analysis.json, judge.json, generated-solution.json
    mockReadFile
      .mockResolvedValueOnce(JSON.stringify(tokenAnalysis) as any)
      .mockResolvedValueOnce(JSON.stringify(judgeScore) as any)
      .mockResolvedValueOnce(JSON.stringify(solution) as any);

    const results = await loadAllResults(paths, [tc], 'claude');

    expect(results).toHaveLength(1);
    expect(results[0].testId).toBe('TC-001');
    expect(results[0].difficulty).toBe('easy');
    expect(results[0].tokenAnalysis).toEqual(tokenAnalysis);
    expect(results[0].judgeScore).toEqual(judgeScore);
    expect(results[0].generatedSolution).toEqual(solution);
  });

  it('returns null fields when result files are missing', async () => {
    const paths = makeProjectPaths();
    const tc = makeTestCase({ id: 'TC-002' });

    // All three files missing
    const notFound = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReadFile
      .mockRejectedValueOnce(notFound)
      .mockRejectedValueOnce(notFound)
      .mockRejectedValueOnce(notFound);

    const results = await loadAllResults(paths, [tc], 'claude');

    expect(results).toHaveLength(1);
    expect(results[0].tokenAnalysis).toBeNull();
    expect(results[0].judgeScore).toBeNull();
    expect(results[0].generatedSolution).toBeNull();
  });
});
