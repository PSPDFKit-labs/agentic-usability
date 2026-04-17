import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatSolution, runSandboxedJudge } from '../judge.js';
import { createAdapter } from '../../agents/adapter.js';
import { makeTestCase, makeConfig, makeSolutionFile, makeProjectPaths } from '../../__tests__/helpers/fixtures.js';

vi.mock('../../agents/adapter.js', () => ({
  createAdapter: vi.fn(),
}));

const mockClient = {
  create: vi.fn(),
  runCommand: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
  runCommandTimed: vi.fn(),
  uploadFiles: vi.fn(),
  uploadBinaryFile: vi.fn(),
  destroy: vi.fn(),
};

vi.mock('../../sandbox/opensandbox.js', () => ({
  SandboxClient: vi.fn(function (this: any) {
    Object.assign(this, mockClient);
  }),
}));

vi.mock('../../sandbox/scaffolding.js', () => ({
  scaffoldWorkspace: vi.fn().mockResolvedValue(''),
  uploadSources: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../core/suite-io.js', () => ({
  loadBinaryResult: vi.fn().mockResolvedValue(null),
  saveResult: vi.fn(),
}));

vi.mock('../../proxy/env-rewriter.js', () => ({
  stampProxyTag: vi.fn().mockImplementation((env: any) => env),
}));

const mockCreateAdapter = vi.mocked(createAdapter);

const validScore = {
  apiDiscovery: 90,
  callCorrectness: 85,
  completeness: 80,
  functionalCorrectness: 88,
  overallVerdict: true,
  notes: 'Good implementation',
};

function makeMockAdapter(opts: { stdout: string }) {
  return {
    name: 'mock',
    installCommand: null,
    run: vi.fn(),
    interactive: vi.fn(),
    sandboxCommand: vi.fn().mockReturnValue('claude --print "prompt"'),
    extractResult: vi.fn().mockImplementation((stdout: string) => stdout),
  };
}

describe('formatSolution', () => {
  it('formats multiple files with path headers', () => {
    const files = [
      makeSolutionFile({ path: 'a.ts', content: 'code a' }),
      makeSolutionFile({ path: 'b.ts', content: 'code b' }),
    ];
    const result = formatSolution(files);
    expect(result).toContain('--- File: a.ts ---');
    expect(result).toContain('--- File: b.ts ---');
    expect(result).toContain('code a');
    expect(result).toContain('code b');
  });

  it('handles empty file array', () => {
    expect(formatSolution([])).toBe('');
  });

  it('handles single file', () => {
    const result = formatSolution([makeSolutionFile({ path: 'x.ts', content: 'hi' })]);
    expect(result).toContain('--- File: x.ts ---');
    expect(result).toContain('hi');
  });
});

describe('runSandboxedJudge', () => {
  const paths = makeProjectPaths();
  const config = makeConfig({
    targets: [{ name: 'claude', image: 'node:20' }],
    sandbox: { domain: 'localhost:8080' },
  });
  const target = config.targets[0];

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.create.mockResolvedValue(undefined);
    mockClient.runCommand.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    mockClient.uploadFiles.mockResolvedValue(undefined);
    mockClient.destroy.mockResolvedValue(undefined);
  });

  it('returns a valid JudgeScore when sandbox agent returns valid JSON', async () => {
    const adapter = makeMockAdapter({ stdout: '' });
    mockCreateAdapter.mockReturnValue(adapter);
    mockClient.runCommandTimed.mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify(validScore),
      stderr: '',
      durationMs: 1000,
    });

    const result = await runSandboxedJudge(
      makeTestCase(), [makeSolutionFile()], { command: 'claude' },
      target, config, paths,
    );

    expect(result.testId).toBe('TC-001');
    expect(result.target).toBe('claude');
    expect(result.apiDiscovery).toBe(90);
    expect(result.overallVerdict).toBe(true);
  });

  it('creates sandbox, scaffolds workspace, and destroys on completion', async () => {
    const adapter = makeMockAdapter({ stdout: '' });
    mockCreateAdapter.mockReturnValue(adapter);
    mockClient.runCommandTimed.mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify(validScore),
      stderr: '',
      durationMs: 1000,
    });

    await runSandboxedJudge(
      makeTestCase(), [makeSolutionFile()], { command: 'claude' },
      target, config, paths,
    );

    expect(mockClient.create).toHaveBeenCalledWith('node:20', undefined, undefined);
    expect(mockClient.destroy).toHaveBeenCalled();
  });

  it('extracts JSON from markdown fenced blocks', async () => {
    const adapter = makeMockAdapter({ stdout: '' });
    mockCreateAdapter.mockReturnValue(adapter);
    mockClient.runCommandTimed.mockResolvedValue({
      exitCode: 0,
      stdout: '```json\n' + JSON.stringify(validScore) + '\n```',
      stderr: '',
      durationMs: 1000,
    });

    const result = await runSandboxedJudge(
      makeTestCase(), [makeSolutionFile()], { command: 'claude' },
      target, config, paths,
    );
    expect(result.apiDiscovery).toBe(90);
  });

  it('throws when output is not valid JSON', async () => {
    const adapter = makeMockAdapter({ stdout: '' });
    mockCreateAdapter.mockReturnValue(adapter);
    mockClient.runCommandTimed.mockResolvedValue({
      exitCode: 0,
      stdout: 'not json at all',
      stderr: '',
      durationMs: 1000,
    });

    await expect(
      runSandboxedJudge(makeTestCase(), [makeSolutionFile()], { command: 'claude' }, target, config, paths),
    ).rejects.toThrow(/not valid JSON/);
    expect(mockClient.destroy).toHaveBeenCalled();
  });

  it('throws when validation fails (out-of-range numbers)', async () => {
    const badScore = { ...validScore, apiDiscovery: 150 };
    const adapter = makeMockAdapter({ stdout: '' });
    mockCreateAdapter.mockReturnValue(adapter);
    mockClient.runCommandTimed.mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify(badScore),
      stderr: '',
      durationMs: 1000,
    });

    await expect(
      runSandboxedJudge(makeTestCase(), [makeSolutionFile()], { command: 'claude' }, target, config, paths),
    ).rejects.toThrow(/validation failed/);
    expect(mockClient.destroy).toHaveBeenCalled();
  });

  it('throws when validation fails (missing fields)', async () => {
    const adapter = makeMockAdapter({ stdout: '' });
    mockCreateAdapter.mockReturnValue(adapter);
    mockClient.runCommandTimed.mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({ apiDiscovery: 90 }),
      stderr: '',
      durationMs: 1000,
    });

    await expect(
      runSandboxedJudge(makeTestCase(), [makeSolutionFile()], { command: 'claude' }, target, config, paths),
    ).rejects.toThrow(/validation failed/);
  });

  it('destroys sandbox even when agent throws', async () => {
    const adapter = makeMockAdapter({ stdout: '' });
    mockCreateAdapter.mockReturnValue(adapter);
    mockClient.runCommandTimed.mockResolvedValue({
      exitCode: 0,
      stdout: 'garbage',
      stderr: '',
      durationMs: 1000,
    });

    await expect(
      runSandboxedJudge(makeTestCase(), [makeSolutionFile()], { command: 'claude' }, target, config, paths),
    ).rejects.toThrow();
    expect(mockClient.destroy).toHaveBeenCalled();
  });

  it('unwraps agent envelope before parsing judge scores', async () => {
    const envelope = JSON.stringify({
      type: 'result',
      structured_output: validScore,
      result: '',
    });
    const adapter = makeMockAdapter({ stdout: '' });
    // Simulate Claude adapter: extractResult unwraps structured_output
    adapter.extractResult.mockReturnValue(JSON.stringify(validScore));
    mockCreateAdapter.mockReturnValue(adapter);
    mockClient.runCommandTimed.mockResolvedValue({
      exitCode: 0,
      stdout: envelope,
      stderr: '',
      durationMs: 1000,
    });

    const result = await runSandboxedJudge(
      makeTestCase(), [makeSolutionFile()], { command: 'claude' },
      target, config, paths,
    );

    expect(adapter.extractResult).toHaveBeenCalledWith(envelope);
    expect(result.apiDiscovery).toBe(90);
    expect(result.overallVerdict).toBe(true);
  });

  it('uploads solution files when no snapshot is available', async () => {
    const adapter = makeMockAdapter({ stdout: '' });
    mockCreateAdapter.mockReturnValue(adapter);
    mockClient.runCommandTimed.mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify(validScore),
      stderr: '',
      durationMs: 1000,
    });

    await runSandboxedJudge(
      makeTestCase(), [makeSolutionFile({ path: 'index.ts', content: 'code' })],
      { command: 'claude' }, target, config, paths,
    );

    // Should upload PROBLEM.md and solution files
    const uploadCalls = mockClient.uploadFiles.mock.calls;
    const allFiles = uploadCalls.flatMap((call: any) => call[0]);
    expect(allFiles.some((f: any) => f.path === '/workspace/PROBLEM.md')).toBe(true);
    expect(allFiles.some((f: any) => f.path.includes('/workspace/solution/'))).toBe(true);
  });

  it('restores snapshot tarball when available', async () => {
    const { loadBinaryResult } = await import('../../core/suite-io.js');
    vi.mocked(loadBinaryResult).mockResolvedValueOnce(Buffer.from('fake-tar'));

    const adapter = makeMockAdapter({ stdout: '' });
    mockCreateAdapter.mockReturnValue(adapter);
    mockClient.runCommandTimed.mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify(validScore),
      stderr: '',
      durationMs: 1000,
    });

    await runSandboxedJudge(
      makeTestCase(), [makeSolutionFile()],
      { command: 'claude' }, target, config, paths,
    );

    expect(mockClient.uploadBinaryFile).toHaveBeenCalledWith(
      '/tmp/workspace-snapshot.tar.gz',
      expect.any(Buffer),
    );
    expect(mockClient.runCommand).toHaveBeenCalledWith(
      expect.stringContaining('tar xzf'),
    );
  });
});
