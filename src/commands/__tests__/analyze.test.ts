import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeConfig, makeTestCase, makeSolutionFile } from '../../__tests__/helpers/fixtures.js';

vi.mock('../../core/config.js', () => ({
  loadConfig: vi.fn(),
  ensureWorkingDir: vi.fn(),
}));

vi.mock('../../core/suite-io.js', () => ({
  loadTestSuite: vi.fn(),
  loadSolution: vi.fn(),
  saveResult: vi.fn(),
  RESULTS_DIR: 'results',
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

import { loadConfig, ensureWorkingDir } from '../../core/config.js';
import { loadTestSuite, loadSolution, saveResult } from '../../core/suite-io.js';
import { analyzeTokens } from '../../scoring/tokens.js';
import { analyzeCommand } from '../analyze.js';

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
    vi.mocked(ensureWorkingDir).mockResolvedValue('/working');
    vi.mocked(loadTestSuite).mockResolvedValue([makeTestCase()]);
    vi.mocked(loadSolution).mockResolvedValue([makeSolutionFile()]);
    vi.mocked(analyzeTokens).mockReturnValue(makeTokenAnalysis() as any);
  });

  it('loads config and test suite', async () => {
    await analyzeCommand();

    expect(loadConfig).toHaveBeenCalled();
    expect(ensureWorkingDir).toHaveBeenCalled();
    expect(loadTestSuite).toHaveBeenCalled();
  });

  it('analyzes solutions for each target and test case', async () => {
    await analyzeCommand();

    expect(loadSolution).toHaveBeenCalledWith('TC-001', 'claude');
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

    await analyzeCommand();

    expect(analyzeTokens).toHaveBeenCalledWith(
      [],
      ['add'],
      ['export', 'function|const'],
      'TC-001',
      'claude',
    );
  });

  it('saves token-analysis.json for each test case', async () => {
    await analyzeCommand();

    expect(saveResult).toHaveBeenCalledWith(
      'TC-001',
      'token-analysis.json',
      expect.any(String),
      'claude',
    );
  });
});
