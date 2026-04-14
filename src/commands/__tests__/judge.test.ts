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

vi.mock('../../scoring/judge.js', () => ({
  runJudge: vi.fn(),
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
import { runJudge } from '../../scoring/judge.js';
import { judgeCommand } from '../judge.js';

const paths = makeProjectPaths();

function makeJudgeScore() {
  return {
    apiDiscovery: 90,
    callCorrectness: 100,
    completeness: 80,
    functionalCorrectness: 88,
    overallVerdict: true,
  };
}

describe('judgeCommand', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    vi.mocked(loadConfig).mockResolvedValue(makeConfig());
    vi.mocked(loadTestSuite).mockResolvedValue([makeTestCase()]);
    vi.mocked(loadSolution).mockResolvedValue([makeSolutionFile()]);
    vi.mocked(runJudge).mockResolvedValue(makeJudgeScore() as any);
  });

  it('skips when skipJudge option is true', async () => {
    await judgeCommand(paths, { skipJudge: true });

    expect(loadConfig).not.toHaveBeenCalled();
    expect(loadTestSuite).not.toHaveBeenCalled();
  });

  it('runs judge for each target and test case', async () => {
    await judgeCommand(paths);

    expect(loadSolution).toHaveBeenCalledWith(paths, 'TC-001', 'claude');
    expect(runJudge).toHaveBeenCalledWith(
      makeTestCase(),
      [makeSolutionFile()],
      expect.objectContaining({ command: 'claude' }),
      'claude',
    );
  });

  it('skips test cases with no generated solution', async () => {
    vi.mocked(loadSolution).mockResolvedValue(null);

    await judgeCommand(paths);

    expect(runJudge).not.toHaveBeenCalled();
  });

  it('saves judge.json on success', async () => {
    await judgeCommand(paths);

    expect(saveResult).toHaveBeenCalledWith(
      paths,
      'TC-001',
      'judge.json',
      expect.any(String),
      'claude',
    );
  });

  it('saves judge-error.log and continues on judge failure', async () => {
    vi.mocked(runJudge).mockRejectedValue(new Error('judge crashed'));

    await judgeCommand(paths);

    expect(saveResult).toHaveBeenCalledWith(
      paths,
      'TC-001',
      'judge-error.log',
      'judge crashed',
      'claude',
    );
  });
});
