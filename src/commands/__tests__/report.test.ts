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
import { readFile } from 'node:fs/promises';
import { reportCommand } from '../report.js';

const paths = makeProjectPaths();

function makeJudgeJson() {
  return JSON.stringify({
    testId: 'TC-001',
    target: 'claude',
    apiDiscovery: 90,
    callCorrectness: 85,
    completeness: 80,
    functionalCorrectness: 88,
    overallVerdict: true,
    notes: 'good',
  });
}

function makeSolutionJson() {
  return JSON.stringify([{ path: 'a.ts', content: 'code' }]);
}

function setupReadFileMock() {
  vi.mocked(readFile).mockImplementation(async (filePath: any) => {
    const p = String(filePath);
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
      makeTestCase({ id: 'TC-001', difficulty: 'easy' }),
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

  it('computes correct aggregate values from judge data', async () => {
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
    expect(agg.avgApiDiscovery).toBe(90);
    expect(agg.avgCallCorrectness).toBe(85);
    expect(agg.avgCompleteness).toBe(80);
    expect(agg.avgFunctionalCorrectness).toBe(88);
    expect(agg.passRate).toBe(100);
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
    expect(byDiff.easy.avgApiDiscovery).toBe(90);
  });

  it('handles missing result files gracefully', async () => {
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
    expect(agg.avgApiDiscovery).toBe(0);
    expect(agg.avgCallCorrectness).toBe(0);
    expect(agg.avgCompleteness).toBe(0);
    expect(agg.avgFunctionalCorrectness).toBe(0);
    expect(agg.passRate).toBe(0);
  });
});
