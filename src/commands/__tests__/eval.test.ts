import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeConfig, makeTestCase, makeProjectPaths } from '../../__tests__/helpers/fixtures.js';

const mockStateManager = {
  load: vi.fn(),
  save: vi.fn(),
  getState: vi.fn().mockReturnValue({
    stage: 'execute',
    completed: { execute: {}, judge: {} },
    testCases: 0,
    startedAt: '',
  }),
  markTestComplete: vi.fn(),
  advanceStage: vi.fn(),
  isTestComplete: vi.fn().mockReturnValue(false),
  getIncompleteTests: vi.fn().mockImplementation((_stage: string, allIds: string[], _target: string) => allIds),
  reset: vi.fn(),
};

vi.mock('../../core/config.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../../core/paths.js', () => ({
  ensureProjectDirs: vi.fn(),
  resolveRunPaths: vi.fn().mockImplementation((paths: any, _runId: string) => paths),
}));

vi.mock('../../core/pipeline.js', () => ({
  PipelineStateManager: vi.fn(function (this: any) {
    Object.assign(this, mockStateManager);
  }),
}));

vi.mock('../../core/suite-io.js', () => ({
  loadTestSuite: vi.fn(),
}));

vi.mock('../../core/runs.js', () => ({
  generateRunId: vi.fn().mockReturnValue('run-test-id'),
  saveRunInfo: vi.fn(),
  loadRunInfo: vi.fn().mockResolvedValue(null),
  listRuns: vi.fn().mockResolvedValue([]),
  getLatestRunId: vi.fn().mockResolvedValue(null),
}));

vi.mock('../report.js', () => ({
  reportCommand: vi.fn(),
}));

vi.mock('../execute.js', () => ({
  prepareSandboxEnv: vi.fn().mockResolvedValue({ proxy: undefined, proxyEnv: undefined, urlProxy: undefined, config: makeConfig() }),
  runExecuteStage: vi.fn().mockResolvedValue({ aborted: false }),
}));

vi.mock('../judge.js', () => ({
  runJudgeStage: vi.fn().mockResolvedValue({ aborted: false }),
}));

vi.mock('node:readline/promises', () => ({
  createInterface: vi.fn().mockReturnValue({
    question: vi.fn().mockResolvedValue('y'),
    close: vi.fn(),
  }),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockRejectedValue(new Error('not found')),
  mkdir: vi.fn().mockResolvedValue(undefined),
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
import { reportCommand } from '../report.js';
import { runExecuteStage } from '../execute.js';
import { runJudgeStage } from '../judge.js';
import { evalCommand } from '../eval.js';

const paths = makeProjectPaths();

const defaultConfig = makeConfig({
  targets: [{ name: 'claude', image: 'node:20' }],
  sandbox: { domain: 'localhost:8080' },
});
const defaultTestCase = makeTestCase({ id: 'TC-001' });

describe('evalCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    vi.mocked(loadConfig).mockResolvedValue(defaultConfig);
    vi.mocked(loadTestSuite).mockResolvedValue([defaultTestCase]);
    vi.mocked(reportCommand).mockResolvedValue(undefined);
    vi.mocked(runExecuteStage).mockResolvedValue({ aborted: false });
    vi.mocked(runJudgeStage).mockResolvedValue({ aborted: false });

    mockStateManager.load.mockResolvedValue(undefined);
    mockStateManager.save.mockResolvedValue(undefined);
    mockStateManager.getState.mockReturnValue({
      stage: 'execute',
      completed: { execute: {}, judge: {} },
      testCases: 0,
      startedAt: '',
    });
    mockStateManager.markTestComplete.mockReturnValue(undefined);
    mockStateManager.advanceStage.mockReturnValue(undefined);
    mockStateManager.getIncompleteTests.mockImplementation((_stage: string, allIds: string[]) => allIds);
    mockStateManager.reset.mockResolvedValue(undefined);
  });

  it('runs all eval stages in order', async () => {
    await evalCommand(paths);

    expect(runExecuteStage).toHaveBeenCalled();
    expect(runJudgeStage).toHaveBeenCalled();
    expect(reportCommand).toHaveBeenCalled();
  });

  it('resumes from saved state and skips execute if stage > execute', async () => {
    const { listRuns } = await import('../../core/runs.js');
    vi.mocked(listRuns).mockResolvedValue([{
      id: 'run-existing',
      createdAt: new Date().toISOString(),
      targets: ['claude'],
      testCount: 1,
      label: null,
    }]);

    mockStateManager.getState.mockReturnValue({
      stage: 'judge',
      completed: { execute: { claude: ['TC-001'] }, judge: {} },
      testCases: 1,
      startedAt: '',
    });

    await evalCommand(paths, { resume: true });

    expect(mockStateManager.load).toHaveBeenCalled();
    expect(runExecuteStage).not.toHaveBeenCalled();
    expect(runJudgeStage).toHaveBeenCalled();
  });

  it('calls advanceStage after each completed stage', async () => {
    await evalCommand(paths);

    expect(mockStateManager.advanceStage).toHaveBeenCalledWith('judge');
    expect(mockStateManager.advanceStage).toHaveBeenCalledWith('report');
  });

  it('saves pipeline state after stage transitions', async () => {
    await evalCommand(paths);

    expect(mockStateManager.save).toHaveBeenCalled();
    expect(mockStateManager.save.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
