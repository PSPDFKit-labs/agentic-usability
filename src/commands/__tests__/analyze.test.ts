import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeConfig, makeTestCase, makeSolutionFile, makeProjectPaths } from '../../__tests__/helpers/fixtures.js';

vi.mock('../../core/config.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../../core/paths.js', () => ({
  ensureProjectDirs: vi.fn(),
}));

vi.mock('../../core/suite-io.js', () => ({
  loadTestSuite: vi.fn(),
  loadSolution: vi.fn(),
  saveResult: vi.fn(),
}));

vi.mock('../../scoring/tokens.js', () => ({
  analyzeTokens: vi.fn(),
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
import { loadTestSuite, loadSolution, saveResult } from '../../core/suite-io.js';
import { analyzeTokens } from '../../scoring/tokens.js';
import { analyzeCommand } from '../analyze.js';

const paths = makeProjectPaths();

function makeTokenAnalysis() {
  return {
    testId: 'TC-001',
    target: 'claude',
    apis: [{ name: 'add', found: true }],
    tokens: [{ pattern: 'export', found: true }],
    apiCoverage: 100,
    tokenCoverage: 100,
  };
}

describe('analyzeCommand', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    vi.mocked(loadConfig).mockResolvedValue(makeConfig());
    vi.mocked(loadTestSuite).mockResolvedValue([makeTestCase()]);
    vi.mocked(loadSolution).mockResolvedValue([makeSolutionFile()]);
    vi.mocked(analyzeTokens).mockReturnValue(makeTokenAnalysis() as any);
  });

  it('loads config and test suite', async () => {
    await analyzeCommand(paths);

    expect(loadConfig).toHaveBeenCalledWith(paths.config);
    expect(loadTestSuite).toHaveBeenCalledWith(paths);
  });

  it('analyzes solutions for each target and test case', async () => {
    await analyzeCommand(paths);

    expect(loadSolution).toHaveBeenCalledWith(paths, 'TC-001', 'claude');
    expect(analyzeTokens).toHaveBeenCalledWith(
      [makeSolutionFile()],
      ['add'],
      ['export', 'function|const'],
      'TC-001',
      'claude',
    );
  });

  it('handles missing solutions with empty array passed to analyzeTokens', async () => {
    vi.mocked(loadSolution).mockResolvedValue(null);

    await analyzeCommand(paths);

    expect(analyzeTokens).toHaveBeenCalledWith(
      [],
      ['add'],
      ['export', 'function|const'],
      'TC-001',
      'claude',
    );
  });

  it('filters test cases when testIds is provided', async () => {
    const tc1 = makeTestCase({ id: 'TC-001' });
    const tc2 = makeTestCase({ id: 'TC-002' });
    vi.mocked(loadTestSuite).mockResolvedValue([tc1, tc2]);

    await analyzeCommand(paths, { testIds: ['TC-002'] });

    expect(loadSolution).toHaveBeenCalledTimes(1);
    expect(loadSolution).toHaveBeenCalledWith(paths, 'TC-002', 'claude');
  });

  it('saves token-analysis.json for each test case', async () => {
    await analyzeCommand(paths);

    expect(saveResult).toHaveBeenCalledWith(
      paths,
      'TC-001',
      'token-analysis.json',
      expect.any(String),
      'claude',
    );
  });
});
