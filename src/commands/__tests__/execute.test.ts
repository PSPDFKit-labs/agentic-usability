import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeConfig, makeTestCase, makeProjectPaths } from '../../__tests__/helpers/fixtures.js';

const mockSandboxInstance = {
  create: vi.fn(),
  getSandbox: vi.fn().mockReturnValue({}),
  uploadFiles: vi.fn(),
  runCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
  runCommandTimed: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 100 }),
  listFiles: vi.fn().mockResolvedValue(['/workspace/solution/solution__a.ts']),
  readFile: vi.fn().mockResolvedValue('code'),
  readBinaryFile: vi.fn().mockResolvedValue(Buffer.alloc(0)),
  uploadBinaryFile: vi.fn(),
  fileExists: vi.fn().mockResolvedValue(false),
  destroy: vi.fn(),
};

vi.mock('../../core/env.js', () => ({
  loadDotenv: vi.fn(),
}));

vi.mock('../../core/config.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../../core/paths.js', () => ({
  ensureProjectDirs: vi.fn(),
}));

vi.mock('../../core/suite-io.js', () => ({
  loadTestSuite: vi.fn(),
  saveResult: vi.fn(),
  saveBinaryResult: vi.fn(),
  formatElapsed: vi.fn().mockReturnValue('1s'),
}));

vi.mock('../../sandbox/microsandbox.js', () => {
  const MockMicrosandboxClient = vi.fn(function (this: any) {
    Object.assign(this, mockSandboxInstance);
  }) as any;
  return {
    MicrosandboxClient: MockMicrosandboxClient,
    buildSecrets: vi.fn().mockReturnValue([]),
    buildAgentSecret: vi.fn().mockReturnValue({}),
    resolveEnv: vi.fn().mockReturnValue({}),
  };
});

vi.mock('../../sandbox/egress-logger.js', () => ({
  createEgressLogger: vi.fn().mockReturnValue({
    getLogs: vi.fn().mockReturnValue([]),
    getLogsForHost: vi.fn().mockReturnValue([]),
    done: Promise.resolve(),
  }),
}));

vi.mock('../../sandbox/scaffolding.js', () => ({
  scaffoldWorkspace: vi.fn().mockResolvedValue('setup log'),
}));

vi.mock('../../sandbox/worker-pool.js', () => ({
  WorkerPool: vi.fn(function (this: any) {
    this.run = vi.fn().mockResolvedValue({ passed: 1, failed: 0 });
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

import { loadConfig } from '../../core/config.js';
import { loadTestSuite, saveResult } from '../../core/suite-io.js';
import { MicrosandboxClient } from '../../sandbox/microsandbox.js';
import { scaffoldWorkspace } from '../../sandbox/scaffolding.js';
import { executeTestCase, executeCommand } from '../execute.js';

const paths = makeProjectPaths();

const defaultConfig = makeConfig({
  targets: [{ name: 'claude', image: 'node:20' }],
  sandbox: {},
  publicInfo: [
    { type: 'package' as const, name: 'test-sdk' },
    { type: 'url' as const, url: 'https://example.com/docs' },
  ],
});

const defaultTarget = { name: 'claude', image: 'node:20' };
const defaultTestCase = makeTestCase({ id: 'TC-001' });

describe('executeTestCase', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    // Reset mock instance methods
    mockSandboxInstance.create.mockReset().mockResolvedValue(undefined);
    mockSandboxInstance.getSandbox.mockReset().mockReturnValue({});
    mockSandboxInstance.uploadFiles.mockReset().mockResolvedValue(undefined);
    mockSandboxInstance.runCommand.mockReset().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
    mockSandboxInstance.runCommandTimed.mockReset().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 100 });
    mockSandboxInstance.listFiles.mockReset().mockResolvedValue(['/workspace/solution/solution__a.ts']);
    mockSandboxInstance.readFile.mockReset().mockResolvedValue('code');
    mockSandboxInstance.readBinaryFile.mockReset().mockResolvedValue(Buffer.alloc(0));
    mockSandboxInstance.fileExists.mockReset().mockResolvedValue(false);
    mockSandboxInstance.destroy.mockReset().mockResolvedValue(undefined);

    vi.mocked(scaffoldWorkspace).mockResolvedValue('setup log');
    vi.mocked(saveResult).mockResolvedValue(undefined);
  });

  it('creates sandbox, scaffolds, uploads PROBLEM.md, runs agent, extracts solution, shuts down', async () => {
    await executeTestCase(defaultTestCase, defaultTarget, defaultConfig, paths);

    expect(MicrosandboxClient).toHaveBeenCalledWith(defaultConfig.sandbox);
    expect(mockSandboxInstance.create).toHaveBeenCalled();
    expect(scaffoldWorkspace).toHaveBeenCalledWith(
      mockSandboxInstance,
      defaultConfig,
      defaultTestCase,
    );
    expect(mockSandboxInstance.uploadFiles).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ path: '/workspace/PROBLEM.md' }),
      ]),
    );
    expect(mockSandboxInstance.runCommandTimed).toHaveBeenCalled();
    expect(mockSandboxInstance.listFiles).toHaveBeenCalledWith('/workspace/solution');
    expect(mockSandboxInstance.readFile).toHaveBeenCalled();
    expect(mockSandboxInstance.destroy).toHaveBeenCalled();
  });

  it('installs agent CLI', async () => {
    await executeTestCase(defaultTestCase, defaultTarget, defaultConfig, paths);

    expect(mockSandboxInstance.runCommand).toHaveBeenCalledWith(
      'npm i -g @anthropic-ai/claude-code',
    );
  });

  it('does not install for unknown agent commands', async () => {
    const config = makeConfig({
      targets: [{ name: 'custom', image: 'node:20' }],
      sandbox: {},
      agents: { executor: { command: 'my-custom-agent', secret: { envVar: 'MY_KEY', value: '$MY_KEY', baseUrl: 'https://api.example.com' } } },
    });

    await executeTestCase(defaultTestCase, defaultTarget, config, paths);

    // No install command should have been called
    expect(mockSandboxInstance.runCommand).not.toHaveBeenCalledWith(
      expect.stringContaining('npm i -g'),
    );
  });

  it('shuts down sandbox in finally block even on error', async () => {
    vi.mocked(scaffoldWorkspace).mockRejectedValue(new Error('scaffold failed'));

    await expect(
      executeTestCase(defaultTestCase, defaultTarget, defaultConfig, paths),
    ).rejects.toThrow('scaffold failed');

    expect(mockSandboxInstance.destroy).toHaveBeenCalled();
  });

  it('saves agent output log and generated solution JSON', async () => {
    await executeTestCase(defaultTestCase, defaultTarget, defaultConfig, paths);

    expect(saveResult).toHaveBeenCalledWith(
      paths,
      'TC-001',
      'agent-output.log',
      expect.stringContaining('Exit code:'),
      'claude',
    );
    expect(saveResult).toHaveBeenCalledWith(
      paths,
      'TC-001',
      'generated-solution.json',
      expect.any(String),
      'claude',
    );
  });

  it('only extracts files with solution__ prefix and strips the prefix', async () => {
    // Override listFiles to return a mix of solution and non-solution files
    mockSandboxInstance.listFiles.mockImplementation(async () => [
      '/workspace/solution/solution__main.py',
      '/workspace/solution/solution__utils.py',
      '/workspace/solution/.venv/bin/python',
      '/workspace/solution/.git/config',
      '/workspace/solution/requirements.txt',
    ]);

    await executeTestCase(defaultTestCase, defaultTarget, defaultConfig, paths);

    // Should only read solution__-prefixed files
    expect(mockSandboxInstance.readFile).toHaveBeenCalledWith('/workspace/solution/solution__main.py');
    expect(mockSandboxInstance.readFile).toHaveBeenCalledWith('/workspace/solution/solution__utils.py');
    expect(mockSandboxInstance.readFile).not.toHaveBeenCalledWith('/workspace/solution/.venv/bin/python');
    expect(mockSandboxInstance.readFile).not.toHaveBeenCalledWith('/workspace/solution/.git/config');
    expect(mockSandboxInstance.readFile).not.toHaveBeenCalledWith('/workspace/solution/requirements.txt');
  });

  it('saves setup log when scaffoldWorkspace returns log content', async () => {
    await executeTestCase(defaultTestCase, defaultTarget, defaultConfig, paths);

    expect(saveResult).toHaveBeenCalledWith(
      paths,
      'TC-001',
      'setup.log',
      'setup log',
      'claude',
    );
  });
});

describe('executeCommand', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    vi.mocked(loadConfig).mockResolvedValue(defaultConfig);
    vi.mocked(loadTestSuite).mockResolvedValue([defaultTestCase]);
  });

  it('loads config and test suite', async () => {
    await executeCommand(paths);

    expect(loadConfig).toHaveBeenCalledWith(paths.config);
    expect(loadTestSuite).toHaveBeenCalledWith(paths);
  });

  it('filters test cases when testIds is provided', async () => {
    const tc1 = makeTestCase({ id: 'TC-001' });
    const tc2 = makeTestCase({ id: 'TC-002' });
    vi.mocked(loadTestSuite).mockResolvedValue([tc1, tc2]);

    await executeCommand(paths, { testIds: ['TC-001'] });

    // loadTestSuite still loads all, but only filtered set is passed to pool
    expect(loadTestSuite).toHaveBeenCalledWith(paths);
  });
});
