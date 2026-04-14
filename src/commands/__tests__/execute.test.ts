import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeConfig, makeTestCase } from '../../__tests__/helpers/fixtures.js';

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
  ensureWorkingDir: vi.fn(),
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
  return { SandboxClient: MockSandboxClient };
});

vi.mock('../../sandbox/docs-fetcher.js', () => ({
  fetchAndCacheDocs: vi.fn().mockResolvedValue('docs content'),
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

import { loadConfig, ensureWorkingDir } from '../../core/config.js';
import { loadTestSuite, saveResult } from '../../core/suite-io.js';
import { SandboxClient } from '../../sandbox/opensandbox.js';
import { fetchAndCacheDocs } from '../../sandbox/docs-fetcher.js';
import { scaffoldWorkspace } from '../../sandbox/scaffolding.js';
import { executeTestCase, executeCommand } from '../execute.js';

const defaultConfig = makeConfig({
  targets: [{ name: 'claude', image: 'node:20' }],
  sandbox: { domain: 'localhost:8080' },
  publicInfo: { docsUrl: 'https://example.com/docs', packageName: 'test-sdk' },
});

const defaultTarget = { name: 'claude', image: 'node:20' };
const defaultTestCase = makeTestCase({ id: 'TC-001' });
const defaultDocs = 'docs content';

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

  it('creates sandbox, scaffolds, uploads files, runs agent, extracts solution, destroys sandbox', async () => {
    await executeTestCase(defaultTestCase, defaultTarget, defaultConfig, defaultDocs);

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
        expect.objectContaining({ path: '/workspace/DOCS.md' }),
      ]),
    );
    expect(mockSandboxInstance.runCommandTimed).toHaveBeenCalled();
    expect(mockSandboxInstance.listFiles).toHaveBeenCalledWith('/workspace/solution');
    expect(mockSandboxInstance.readFile).toHaveBeenCalled();
    expect(mockSandboxInstance.destroy).toHaveBeenCalled();
  });

  it('installs known agent CLI (claude) inside sandbox', async () => {
    await executeTestCase(defaultTestCase, defaultTarget, defaultConfig, defaultDocs);

    // Default executor is 'claude', so npm install @anthropic-ai/claude-code should be called
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

    await executeTestCase(defaultTestCase, defaultTarget, config, defaultDocs);

    // runCommand should NOT be called for install (no known install command)
    expect(mockSandboxInstance.runCommand).not.toHaveBeenCalled();
  });

  it('destroys sandbox in finally block even on error', async () => {
    vi.mocked(scaffoldWorkspace).mockRejectedValue(new Error('scaffold failed'));

    await expect(
      executeTestCase(defaultTestCase, defaultTarget, defaultConfig, defaultDocs),
    ).rejects.toThrow('scaffold failed');

    expect(mockSandboxInstance.destroy).toHaveBeenCalled();
  });

  it('saves agent output log and generated solution JSON', async () => {
    await executeTestCase(defaultTestCase, defaultTarget, defaultConfig, defaultDocs);

    expect(saveResult).toHaveBeenCalledWith(
      'TC-001',
      'agent-output.log',
      expect.stringContaining('Exit code:'),
      'claude',
    );
    expect(saveResult).toHaveBeenCalledWith(
      'TC-001',
      'generated-solution.json',
      expect.any(String),
      'claude',
    );
  });

  it('saves setup log when scaffoldWorkspace returns log content', async () => {
    await executeTestCase(defaultTestCase, defaultTarget, defaultConfig, defaultDocs);

    expect(saveResult).toHaveBeenCalledWith(
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
    vi.mocked(ensureWorkingDir).mockResolvedValue('/working');
    vi.mocked(loadTestSuite).mockResolvedValue([defaultTestCase]);
    (SandboxClient.checkConnectivity as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    vi.mocked(fetchAndCacheDocs).mockResolvedValue('docs content');
  });

  it('loads config, test suite, checks connectivity, fetches docs', async () => {
    await executeCommand();

    expect(loadConfig).toHaveBeenCalled();
    expect(ensureWorkingDir).toHaveBeenCalled();
    expect(loadTestSuite).toHaveBeenCalled();
    expect(SandboxClient.checkConnectivity).toHaveBeenCalledWith(defaultConfig.sandbox);
    expect(fetchAndCacheDocs).toHaveBeenCalled();
  });
});
