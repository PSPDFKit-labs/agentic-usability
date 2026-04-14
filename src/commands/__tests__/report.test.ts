import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeConfig, makeTestCase, makeProjectPaths } from '../../__tests__/helpers/fixtures.js';

vi.mock('../../core/config.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../../core/paths.js', () => ({
  ensureProjectDirs: vi.fn(),
}));

vi.mock('../../core/suite-io.js', () => ({
  loadTestSuite: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
  })),
}));

import { loadConfig } from '../../core/config.js';
import { loadTestSuite } from '../../core/suite-io.js';
import { readFile, writeFile } from 'node:fs/promises';
import { reportCommand, exportResultsCommand } from '../report.js';

const paths = makeProjectPaths();

function makeTokenAnalysisJson() {
  return JSON.stringify({
    testId: 'TC-001',
    target: 'claude',
    apis: [{ token: 'createClient', found: true }],
    tokens: [{ token: 'import', found: true }],
    apiCoverage: 100,
    tokenCoverage: 100,
  });
}

function makeJudgeJson() {
  return JSON.stringify({
    testId: 'TC-001',
    target: 'claude',
    functionalEquivalence: 90,
    apiCorrectness: 85,
    idiomaticUsage: 80,
    overallSimilarity: 88,
    functionalMatch: true,
    notes: 'good',
  });
}

function makeSolutionJson() {
  return JSON.stringify([{ path: 'a.ts', content: 'code' }]);
}

function setupReadFileMock() {
  vi.mocked(readFile).mockImplementation(async (filePath: any) => {
    const p = String(filePath);
    if (p.endsWith('token-analysis.json')) return makeTokenAnalysisJson();
    if (p.endsWith('judge.json')) return makeJudgeJson();
    if (p.endsWith('generated-solution.json')) return makeSolutionJson();
    throw new Error(`File not found: ${p}`);
  });
}

describe('reportCommand', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    vi.mocked(loadConfig).mockResolvedValue(
      makeConfig({ targets: [{ name: 'claude', image: 'node:20' }] }),
    );
    vi.mocked(loadTestSuite).mockResolvedValue([
      makeTestCase({
        id: 'TC-001',
        difficulty: 'easy',
        targetApis: ['createClient'],
        expectedTokens: ['import'],
      }),
    ]);
    setupReadFileMock();
  });

  it('loads config and test suite, displays scorecard', async () => {
    await reportCommand(paths);

    expect(loadConfig).toHaveBeenCalledWith(paths.config);
    expect(loadTestSuite).toHaveBeenCalledWith(paths);
    expect(console.log).toHaveBeenCalled();
  });

  it('outputs JSON when json option is true', async () => {
    await reportCommand(paths, { json: true });

    const calls = vi.mocked(console.log).mock.calls;
    const jsonCall = calls.find(([arg]) => {
      try {
        const parsed = JSON.parse(arg);
        return parsed.targets !== undefined;
      } catch {
        return false;
      }
    });

    expect(jsonCall).toBeDefined();
    const parsed = JSON.parse(jsonCall![0]);
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].target).toBe('claude');
  });

  it('computes correct aggregate values from analysis and judge data', async () => {
    await reportCommand(paths, { json: true });

    const calls = vi.mocked(console.log).mock.calls;
    const jsonCall = calls.find(([arg]) => {
      try {
        return JSON.parse(arg).targets !== undefined;
      } catch {
        return false;
      }
    });

    const parsed = JSON.parse(jsonCall![0]);
    const agg = parsed.targets[0].aggregates;
    expect(agg.avgApiCoverage).toBe(100);
    expect(agg.avgTokenCoverage).toBe(100);
    expect(agg.avgSimilarity).toBe(88);
  });

  it('includes byDifficulty breakdown in JSON output', async () => {
    await reportCommand(paths, { json: true });

    const calls = vi.mocked(console.log).mock.calls;
    const jsonCall = calls.find(([arg]) => {
      try {
        return JSON.parse(arg).targets !== undefined;
      } catch {
        return false;
      }
    });

    const parsed = JSON.parse(jsonCall![0]);
    const byDiff = parsed.targets[0].aggregates.byDifficulty;
    expect(byDiff.easy).toBeDefined();
    expect(byDiff.easy.count).toBe(1);
    expect(byDiff.easy.avgApiCoverage).toBe(100);
  });

  it('handles missing analysis files gracefully', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('File not found'));

    await reportCommand(paths, { json: true });

    const calls = vi.mocked(console.log).mock.calls;
    const jsonCall = calls.find(([arg]) => {
      try {
        return JSON.parse(arg).targets !== undefined;
      } catch {
        return false;
      }
    });

    const parsed = JSON.parse(jsonCall![0]);
    const agg = parsed.targets[0].aggregates;
    expect(agg.avgApiCoverage).toBe(0);
    expect(agg.avgTokenCoverage).toBe(0);
    expect(agg.avgSimilarity).toBe(0);
  });

  it('reports worstApis when some APIs are missed', async () => {
    vi.mocked(readFile).mockImplementation(async (filePath: any) => {
      const p = String(filePath);
      if (p.endsWith('token-analysis.json')) {
        return JSON.stringify({
          testId: 'TC-001',
          target: 'claude',
          apis: [
            { token: 'createClient', found: true },
            { token: 'destroyClient', found: false },
          ],
          tokens: [{ token: 'import', found: true }],
          apiCoverage: 50,
          tokenCoverage: 100,
        });
      }
      if (p.endsWith('judge.json')) return makeJudgeJson();
      if (p.endsWith('generated-solution.json')) return makeSolutionJson();
      throw new Error(`File not found: ${p}`);
    });

    await reportCommand(paths, { json: true });

    const calls = vi.mocked(console.log).mock.calls;
    const jsonCall = calls.find(([arg]) => {
      try {
        return JSON.parse(arg).targets !== undefined;
      } catch {
        return false;
      }
    });

    const parsed = JSON.parse(jsonCall![0]);
    expect(parsed.targets[0].worstApis).toHaveLength(1);
    expect(parsed.targets[0].worstApis[0].api).toBe('destroyClient');
    expect(parsed.targets[0].worstApis[0].missRate).toBe(100);
  });
});

describe('exportResultsCommand', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    vi.mocked(loadConfig).mockResolvedValue(
      makeConfig({ targets: [{ name: 'claude', image: 'node:20' }] }),
    );
    vi.mocked(loadTestSuite).mockResolvedValue([
      makeTestCase({
        id: 'TC-001',
        difficulty: 'easy',
        targetApis: ['createClient'],
        expectedTokens: ['import'],
      }),
    ]);
    setupReadFileMock();
    vi.mocked(writeFile).mockResolvedValue(undefined);
  });

  it('writes aggregated results to the specified output file', async () => {
    await exportResultsCommand(paths, { output: '/tmp/results.json' });

    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining('results.json'),
      expect.any(String),
      'utf-8',
    );

    const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].target).toBe('claude');
  });
});
