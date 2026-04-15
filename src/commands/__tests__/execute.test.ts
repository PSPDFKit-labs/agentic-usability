import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeConfig, makeTestCase, makeProjectPaths } from '../../__tests__/helpers/fixtures.js';

const mockSandboxInstance = {
  create: vi.fn(),
  uploadFiles: vi.fn(),
  runCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
  runCommandTimed: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 100 }),
  listFiles: vi.fn().mockResolvedValue(['solution/a.ts']),
  readFile: vi.fn().mockResolvedValue('code'),
  destroy: vi.fn(),
};

vi.mock('../../core/config.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../../core/paths.js', () => ({
  ensureProjectDirs: vi.fn(),
}));

vi.mock('../../core/suite-io.js', () => ({
  loadTestSuite: vi.fn(),
  saveResult: vi.fn(),
  formatElapsed: vi.fn().mockReturnValue('1s'),
}));

vi.mock('../../sandbox/opensandbox.js', () => {
  const MockSandboxClient = vi.fn(function (this: any) {
    Object.assign(this, mockSandboxInstance);
  }) as any;
  MockSandboxClient.checkConnectivity = vi.fn();
  return {
    SandboxClient: MockSandboxClient,
    getSandboxHostAddress: vi.fn().mockReturnValue('host.docker.internal'),
  };
});

vi.mock('../../proxy/env-rewriter.js', () => ({
  rewriteEnv: vi.fn().mockReturnValue({ proxyTargets: [], baseUrlVarMap: new Map(), cleanEnv: {} }),
  applyProxyUrls: vi.fn().mockReturnValue({}),
}));

vi.mock('../../proxy/auth-proxy.js', () => ({
  startAuthProxy: vi.fn().mockResolvedValue({ listeners: [], stop: vi.fn() }),
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
import { SandboxClient } from '../../sandbox/opensandbox.js';
import { scaffoldWorkspace } from '../../sandbox/scaffolding.js';
import { executeTestCase, executeCommand } from '../execute.js';

const paths = makeProjectPaths();

const defaultConfig = makeConfig({
  targets: [{ name: 'claude', image: 'node:20' }],
  sandbox: { domain: 'localhost:8080' },
  publicInfo: { docsUrl: 'https://example.com/docs', packageName: 'test-sdk' },
});

const defaultTarget = { name: 'claude', image: 'node:20' };
const defaultTestCase = makeTestCase({ id: 'TC-001' });

describe('executeTestCase', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    // Reset mock instance methods
    mockSandboxInstance.create.mockReset().mockResolvedValue(undefined);
    mockSandboxInstance.uploadFiles.mockReset().mockResolvedValue(undefined);
    mockSandboxInstance.runCommand.mockReset().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
    mockSandboxInstance.runCommandTimed.mockReset().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 100 });
    mockSandboxInstance.listFiles.mockReset().mockResolvedValue(['solution/a.ts']);
    mockSandboxInstance.readFile.mockReset().mockResolvedValue('code');
    mockSandboxInstance.destroy.mockReset().mockResolvedValue(undefined);

    vi.mocked(scaffoldWorkspace).mockResolvedValue('setup log');
    vi.mocked(saveResult).mockResolvedValue(undefined);
  });

  it('creates sandbox, scaffolds, uploads PROBLEM.md, runs agent, extracts solution, destroys sandbox', async () => {
    await executeTestCase(defaultTestCase, defaultTarget, defaultConfig, paths);

    expect(SandboxClient).toHaveBeenCalledWith(defaultConfig.sandbox);
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
      sandbox: { domain: 'localhost:8080' },
      agents: { executor: { command: 'my-custom-agent' } },
    });

    await executeTestCase(defaultTestCase, defaultTarget, config, paths);

    // No install command should have been called
    expect(mockSandboxInstance.runCommand).not.toHaveBeenCalledWith(
      expect.stringContaining('npm i -g'),
    );
  });

  it('destroys sandbox in finally block even on error', async () => {
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
    (SandboxClient.checkConnectivity as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it('loads config, test suite, and checks connectivity', async () => {
    await executeCommand(paths);

    expect(loadConfig).toHaveBeenCalledWith(paths.config);
    expect(loadTestSuite).toHaveBeenCalledWith(paths);
    expect(SandboxClient.checkConnectivity).toHaveBeenCalledWith(defaultConfig.sandbox);
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
