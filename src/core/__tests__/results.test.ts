import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { loadJsonFile, computeAggregates, loadAllResults } from '../results.js';
import type { TestResult } from '../../types.js';
import { makeTestCase, makeProjectPaths } from '../../__tests__/helpers/fixtures.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

const mockReadFile = vi.mocked(readFile);

describe('loadJsonFile', () => {
  beforeEach(() => { mockReadFile.mockReset(); });

  it('returns parsed JSON on success', async () => {
    const data = { foo: 'bar', count: 42 };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(data) as any);
    const result = await loadJsonFile<typeof data>('/fake/file.json');
    expect(result).toEqual(data);
  });

  it('returns null on file not found', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));
    expect(await loadJsonFile('/fake/missing.json')).toBeNull();
  });

  it('returns null on invalid JSON', async () => {
    mockReadFile.mockResolvedValueOnce('not valid json' as any);
    expect(await loadJsonFile('/fake/bad.json')).toBeNull();
  });
});

function makeTestResult(overrides: Partial<TestResult> = {}): TestResult {
  return {
    testId: 'TC-001',
    difficulty: 'easy',
    problemStatement: 'test',
    judgeScore: {
      testId: 'TC-001', target: 't',
      apiDiscovery: 90, callCorrectness: 85,
      completeness: 80, functionalCorrectness: 88,
      overallVerdict: true, notes: 'good',
    },
    generatedSolution: [{ path: 'a.ts', content: 'code' }],
    agentNotes: null,
    ...overrides,
  };
}

describe('computeAggregates', () => {
  it('computes correct averages with judge data', () => {
    const r1 = makeTestResult({
      judgeScore: { testId: 'TC-001', target: 't', apiDiscovery: 60, callCorrectness: 70, completeness: 80, functionalCorrectness: 90, overallVerdict: true, notes: '' },
    });
    const r2 = makeTestResult({
      testId: 'TC-002',
      judgeScore: { testId: 'TC-002', target: 't', apiDiscovery: 40, callCorrectness: 50, completeness: 60, functionalCorrectness: 70, overallVerdict: false, notes: '' },
    });
    const agg = computeAggregates([r1, r2], 'my-target');
    expect(agg.target).toBe('my-target');
    expect(agg.avgApiDiscovery).toBe(50);
    expect(agg.avgCallCorrectness).toBe(60);
    expect(agg.avgCompleteness).toBe(70);
    expect(agg.avgFunctionalCorrectness).toBe(80);
  });

  it('empty results yields all zeros', () => {
    const agg = computeAggregates([], 'target');
    expect(agg.avgApiDiscovery).toBe(0);
    expect(agg.avgCallCorrectness).toBe(0);
    expect(agg.passRate).toBe(0);
  });

  it('no judge data gives zeros', () => {
    const agg = computeAggregates([makeTestResult({ judgeScore: null })], 'target');
    expect(agg.avgApiDiscovery).toBe(0);
    expect(agg.passRate).toBe(0);
  });

  it('by-difficulty breakdown', () => {
    const easy = makeTestResult({ testId: 'E', difficulty: 'easy', judgeScore: { testId: 'E', target: 't', apiDiscovery: 80, callCorrectness: 70, completeness: 60, functionalCorrectness: 50, overallVerdict: true, notes: '' } });
    const hard = makeTestResult({ testId: 'H', difficulty: 'hard', judgeScore: null });
    const agg = computeAggregates([easy, hard], 'target');
    expect(agg.byDifficulty['easy'].avgApiDiscovery).toBe(80);
    expect(agg.byDifficulty['hard'].avgApiDiscovery).toBe(0);
  });

  it('pass rate: 2 pass + 1 fail', () => {
    const pass1 = makeTestResult({ judgeScore: { testId: '1', target: 't', apiDiscovery: 90, callCorrectness: 90, completeness: 90, functionalCorrectness: 90, overallVerdict: true, notes: '' } });
    const pass2 = makeTestResult({ testId: '2', judgeScore: { testId: '2', target: 't', apiDiscovery: 80, callCorrectness: 80, completeness: 80, functionalCorrectness: 80, overallVerdict: true, notes: '' } });
    const fail1 = makeTestResult({ testId: '3', judgeScore: { testId: '3', target: 't', apiDiscovery: 40, callCorrectness: 40, completeness: 40, functionalCorrectness: 40, overallVerdict: false, notes: '' } });
    expect(computeAggregates([pass1, pass2, fail1], 'target').passRate).toBeCloseTo(66.67, 1);
  });
});

describe('loadAllResults', () => {
  beforeEach(() => { mockReadFile.mockReset(); });

  it('loads judge and solution results', async () => {
    const paths = makeProjectPaths();
    const tc = makeTestCase({ id: 'TC-001' });
    const judgeScore = { testId: 'TC-001', target: 'claude', apiDiscovery: 90, callCorrectness: 85, completeness: 80, functionalCorrectness: 88, overallVerdict: true, notes: 'ok' };
    const solution = [{ path: 'solution.ts', content: 'code' }];
    mockReadFile
      .mockResolvedValueOnce(JSON.stringify(judgeScore) as any)
      .mockResolvedValueOnce(JSON.stringify(solution) as any);
    const results = await loadAllResults(paths, [tc], 'claude');
    expect(results).toHaveLength(1);
    expect(results[0].judgeScore).toEqual(judgeScore);
    expect(results[0].generatedSolution).toEqual(solution);
  });

  it('returns null when files are missing', async () => {
    const paths = makeProjectPaths();
    const notFound = new Error('ENOENT');
    mockReadFile.mockRejectedValueOnce(notFound).mockRejectedValueOnce(notFound);
    const results = await loadAllResults(paths, [makeTestCase()], 'claude');
    expect(results[0].judgeScore).toBeNull();
    expect(results[0].generatedSolution).toBeNull();
  });
});
