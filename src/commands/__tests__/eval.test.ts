import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeConfig, makeTestCase, makeProjectPaths } from '../../__tests__/helpers/fixtures.js';

const mockStateManager = {
  load: vi.fn(),
  save: vi.fn(),
  getState: vi.fn().mockReturnValue({
    stage: 'execute',
    completed: { execute: [], analyze: [], judge: [] },
    testCases: 0,
    startedAt: '',
  }),
  markTestComplete: vi.fn(),
  advanceStage: vi.fn(),
  isTestComplete: vi.fn().mockReturnValue(false),
  getIncompleteTests: vi.fn().mockImplementation((_stage: string, allIds: string[]) => allIds),
  reset: vi.fn(),
};

vi.mock('../../core/env.js', () => ({
  loadDotenv: vi.fn(),
}));

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
  loadSolution: vi.fn().mockResolvedValue([{ path: 'a.ts', content: 'code' }]),
  saveResult: vi.fn(),
  formatElapsed: vi.fn().mockReturnValue('1s'),
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
  executeTestCase: vi.fn(),
  startProxy: vi.fn().mockResolvedValue({ proxy: undefined, proxyEnv: undefined }),
}));

vi.mock('../../sandbox/opensandbox.js', () => {
  const MockSandboxClient = vi.fn(function (this: any) {}) as any;
  MockSandboxClient.checkConnectivity = vi.fn();
  return { SandboxClient: MockSandboxClient };
});

vi.mock('../../sandbox/worker-pool.js', () => ({
  WorkerPool: vi.fn(function (this: any) {
    this.run = vi.fn().mockImplementation(async (items: any[], executeFn: any, _onProgress: any) => {
      for (const item of items) {
        await executeFn(item);
      }
      return { passed: items.length, failed: 0 };
    });
  }),
}));

vi.mock('../../scoring/tokens.js', () => ({
  analyzeTokens: vi.fn().mockReturnValue({
    testId: 'TC-001',
    target: 'claude',
    apis: [{ token: 'add', found: true }],
    tokens: [{ token: 'export', found: true }],
    apiCoverage: 100,
    tokenCoverage: 100,
  }),
}));

vi.mock('../../scoring/judge.js', () => ({
  runJudge: vi.fn().mockResolvedValue({
    testId: 'TC-001',
    target: 'claude',
    apiDiscovery: 90,
    callCorrectness: 85,
    completeness: 80,
    functionalCorrectness: 88,
    overallVerdict: true,
    notes: 'good',
  }),
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
import { loadTestSuite, loadSolution, saveResult } from '../../core/suite-io.js';
import { reportCommand } from '../report.js';
import { executeTestCase } from '../execute.js';
import { SandboxClient } from '../../sandbox/opensandbox.js';
import { analyzeTokens } from '../../scoring/tokens.js';
import { runJudge } from '../../scoring/judge.js';
import { PipelineStateManager } from '../../core/pipeline.js';
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
    vi.mocked(executeTestCase).mockResolvedValue(undefined);
    (SandboxClient.checkConnectivity as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    vi.mocked(loadSolution).mockResolvedValue([{ path: 'a.ts', content: 'code' }]);
    vi.mocked(saveResult).mockResolvedValue(undefined);

    // Reset state manager mocks
    mockStateManager.load.mockResolvedValue(undefined);
    mockStateManager.save.mockResolvedValue(undefined);
    mockStateManager.getState.mockReturnValue({
      stage: 'execute',
      completed: { execute: [], analyze: [], judge: [] },
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

    expect(executeTestCase).toHaveBeenCalled();
    expect(analyzeTokens).toHaveBeenCalled();
    expect(runJudge).toHaveBeenCalled();
    expect(reportCommand).toHaveBeenCalled();
  });

  it('skips judge stage when skipJudge is true', async () => {
    await evalCommand(paths, { skipJudge: true });

    expect(executeTestCase).toHaveBeenCalled();
    expect(analyzeTokens).toHaveBeenCalled();
    expect(runJudge).not.toHaveBeenCalled();
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
      stage: 'analyze',
      completed: { execute: ['TC-001'], analyze: [], judge: [] },
      testCases: 1,
      startedAt: '',
    });

    await evalCommand(paths, { resume: true });

    expect(mockStateManager.load).toHaveBeenCalled();
    expect(executeTestCase).not.toHaveBeenCalled();
    expect(analyzeTokens).toHaveBeenCalled();
  });

  it('calls advanceStage after each completed stage', async () => {
    await evalCommand(paths);

    expect(mockStateManager.advanceStage).toHaveBeenCalledWith('analyze');
    expect(mockStateManager.advanceStage).toHaveBeenCalledWith('judge');
    expect(mockStateManager.advanceStage).toHaveBeenCalledWith('report');
  });

  it('saves pipeline state after stage transitions', async () => {
    await evalCommand(paths);

    // save is called multiple times for state persistence
    expect(mockStateManager.save).toHaveBeenCalled();
    expect(mockStateManager.save.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
