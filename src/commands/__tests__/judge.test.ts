import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeConfig, makeTestCase, makeSolutionFile, makeProjectPaths } from '../../__tests__/helpers/fixtures.js';

vi.mock('../../core/config.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../../core/suite-io.js', () => ({
  loadTestSuite: vi.fn(),
  loadSolution: vi.fn(),
  saveResult: vi.fn(),
  formatElapsed: vi.fn().mockReturnValue('1s'),
}));

vi.mock('../../scoring/judge.js', () => ({
  runSandboxedJudge: vi.fn(),
}));

vi.mock('../execute.js', () => ({
  prepareSandboxEnv: vi.fn().mockResolvedValue({ proxy: undefined, proxyEnv: undefined }),
}));

vi.mock('../../sandbox/worker-pool.js', () => ({
  WorkerPool: vi.fn(function (this: any) {
    this.run = vi.fn().mockImplementation(async (items: any[], executeFn: any, _onProgress: any) => {
      let passed = 0;
      let failed = 0;
      for (const item of items) {
        try {
          await executeFn(item);
          passed++;
        } catch {
          failed++;
        }
      }
      return { passed, failed, aborted: false };
    });
  }),
}));

vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
  })),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockRejectedValue(new Error('not found')),
}));

import { loadConfig } from '../../core/config.js';
import { loadTestSuite, loadSolution, saveResult } from '../../core/suite-io.js';
import { runSandboxedJudge } from '../../scoring/judge.js';
import { prepareSandboxEnv } from '../execute.js';
import { judgeCommand } from '../judge.js';

const paths = makeProjectPaths();

function makeJudgeScore() {
  return {
    testId: 'TC-001',
    target: 'claude',
    apiDiscovery: 90,
    callCorrectness: 100,
    completeness: 80,
    functionalCorrectness: 88,
    overallVerdict: true,
    notes: 'good',
  };
}

describe('judgeCommand', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    vi.mocked(loadConfig).mockResolvedValue(makeConfig());
    vi.mocked(loadTestSuite).mockResolvedValue([makeTestCase()]);
    vi.mocked(loadSolution).mockResolvedValue([makeSolutionFile()]);
    vi.mocked(runSandboxedJudge).mockResolvedValue(makeJudgeScore() as any);
    vi.mocked(saveResult).mockResolvedValue(undefined);

    vi.mocked(prepareSandboxEnv).mockResolvedValue({ proxy: undefined, proxyEnv: undefined });
  });

  it('skips when skipJudge option is true', async () => {
    await judgeCommand(paths, { skipJudge: true });

    expect(loadConfig).not.toHaveBeenCalled();
    expect(loadTestSuite).not.toHaveBeenCalled();
  });

  it('runs judge for each target and test case', async () => {
    await judgeCommand(paths);

    expect(loadSolution).toHaveBeenCalledWith(paths, 'TC-001', 'claude');
    expect(runSandboxedJudge).toHaveBeenCalledWith(
      makeTestCase(),
      [makeSolutionFile()],
      expect.objectContaining({ command: 'claude' }),
      expect.objectContaining({ name: 'claude' }),
      expect.any(Object),
      paths,
      undefined,
      undefined,
      undefined,
      expect.any(Object),
    );
  });

  it('skips test cases with no generated solution', async () => {
    vi.mocked(loadSolution).mockResolvedValue(null);

    await judgeCommand(paths);

    expect(runSandboxedJudge).not.toHaveBeenCalled();
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

  it('filters test cases when testIds is provided', async () => {
    const tc1 = makeTestCase({ id: 'TC-001' });
    const tc2 = makeTestCase({ id: 'TC-002' });
    vi.mocked(loadTestSuite).mockResolvedValue([tc1, tc2]);

    await judgeCommand(paths, { testIds: ['TC-002'] });

    expect(loadSolution).toHaveBeenCalledTimes(1);
    expect(loadSolution).toHaveBeenCalledWith(paths, 'TC-002', 'claude');
  });

  it('saves judge-error.log and continues on judge failure', async () => {
    vi.mocked(runSandboxedJudge).mockRejectedValue(new Error('judge crashed'));

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
