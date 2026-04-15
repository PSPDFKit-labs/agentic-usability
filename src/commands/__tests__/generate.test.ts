import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeConfig, makeAgentResult, makeProjectPaths } from '../../__tests__/helpers/fixtures.js';

vi.mock('../../core/config.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../../core/paths.js', () => ({
  ensureProjectDirs: vi.fn(),
}));

vi.mock('../../core/source-resolver.js', () => ({
  resolveSources: vi.fn(),
}));

vi.mock('../../agents/adapter.js', () => ({
  createAdapter: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
  })),
}));

vi.mock('../suite-utils.js', () => ({
  printSuiteTable: vi.fn(),
}));

const VALID_TC = [
  {
    problemStatement: 'task',
    referenceSolution: [{ path: 'a.ts', content: 'code' }],
    difficulty: 'easy',
    targetApis: ['fn'],
    expectedTokens: ['import'],
    tags: ['test'],
  },
];
const VALID_TC_JSON = JSON.stringify(VALID_TC);

function makeAdapter(overrides: Record<string, unknown> = {}) {
  return {
    name: 'test',
    installCommand: null,
    run: vi.fn(),
    interactive: vi.fn(),
    sandboxCommand: vi.fn().mockReturnValue(''),
    ...overrides,
  };
}

import { loadConfig } from '../../core/config.js';
import { resolveSources } from '../../core/source-resolver.js';
import { createAdapter } from '../../agents/adapter.js';
import { readFile, writeFile } from 'node:fs/promises';
import { generateCommand } from '../generate.js';

const paths = makeProjectPaths();

describe('generateCommand (non-interactive)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    vi.mocked(loadConfig).mockResolvedValue(makeConfig());
    vi.mocked(resolveSources).mockResolvedValue(['/tmp/sdk']);
  });

  it('loads config, resolves source, runs adapter, saves suite JSON', async () => {
    const adapter = makeAdapter();
    adapter.run.mockResolvedValue(
      makeAgentResult({ stdout: VALID_TC_JSON }),
    );
    vi.mocked(createAdapter).mockReturnValue(adapter as any);

    await generateCommand(paths, { nonInteractive: true });

    expect(loadConfig).toHaveBeenCalledWith(paths.config);
    expect(resolveSources).toHaveBeenCalled();
    expect(createAdapter).toHaveBeenCalled();
    expect(adapter.run).toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining('suite.json'),
      expect.any(String),
      'utf-8',
    );
  });

  it('auto-assigns IDs to test cases without IDs', async () => {
    const adapter = makeAdapter();
    adapter.run.mockResolvedValue(
      makeAgentResult({ stdout: VALID_TC_JSON }),
    );
    vi.mocked(createAdapter).mockReturnValue(adapter as any);

    await generateCommand(paths, { nonInteractive: true });

    const written = vi.mocked(writeFile).mock.calls[0][1] as string;
    const parsed = JSON.parse(written);
    expect(parsed[0].id).toBe('TC-001');
  });

  it('throws when adapter output is not valid JSON', async () => {
    const adapter = makeAdapter();
    adapter.run.mockResolvedValue(
      makeAgentResult({ stdout: 'not json at all' }),
    );
    vi.mocked(createAdapter).mockReturnValue(adapter as any);

    await expect(generateCommand(paths, { nonInteractive: true })).rejects.toThrow(/not valid JSON/);
  });

  it('always uses project root as workDir', async () => {
    vi.mocked(resolveSources).mockResolvedValue(['/home/user/Downloads/api-spec.yaml']);

    const adapter = makeAdapter();
    adapter.run.mockResolvedValue(
      makeAgentResult({ stdout: VALID_TC_JSON }),
    );
    vi.mocked(createAdapter).mockReturnValue(adapter as any);

    await generateCommand(paths, { nonInteractive: true });

    expect(adapter.run).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      paths.root,
    );
  });

  it('throws when adapter output is not a JSON array', async () => {
    const adapter = makeAdapter();
    adapter.run.mockResolvedValue(
      makeAgentResult({ stdout: JSON.stringify({ not: 'an array' }) }),
    );
    vi.mocked(createAdapter).mockReturnValue(adapter as any);

    await expect(generateCommand(paths, { nonInteractive: true })).rejects.toThrow(/not a JSON array/);
  });
});

describe('generateCommand (interactive)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    vi.mocked(loadConfig).mockResolvedValue(makeConfig());
    vi.mocked(resolveSources).mockResolvedValue(['/tmp/sdk']);
  });

  it('calls adapter.interactive with project root as workDir', async () => {
    const adapter = makeAdapter();
    adapter.interactive.mockResolvedValue({ exitCode: 0, durationMs: 5000 });
    vi.mocked(createAdapter).mockReturnValue(adapter as any);
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(VALID_TC));

    await generateCommand(paths);

    expect(createAdapter).toHaveBeenCalled();
    expect(adapter.interactive).toHaveBeenCalledWith(
      expect.stringContaining('test case generator'),
      paths.root,
    );
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining('suite.json'),
      expect.any(String),
      'utf-8',
    );
  });

  it('includes source path in prompt even when source is a file', async () => {
    vi.mocked(resolveSources).mockResolvedValue(['/home/user/Downloads/api-spec.yaml']);

    const adapter = makeAdapter();
    adapter.interactive.mockResolvedValue({ exitCode: 0, durationMs: 1000 });
    vi.mocked(createAdapter).mockReturnValue(adapter as any);
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(VALID_TC));

    await generateCommand(paths);

    const prompt = adapter.interactive.mock.calls[0][0] as string;
    expect(prompt).toContain('/home/user/Downloads/api-spec.yaml');
    expect(adapter.interactive).toHaveBeenCalledWith(prompt, paths.root);
  });

  it('throws when agent does not write the suite file', async () => {
    const adapter = makeAdapter();
    adapter.interactive.mockResolvedValue({ exitCode: 0, durationMs: 1000 });
    vi.mocked(createAdapter).mockReturnValue(adapter as any);
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

    await expect(generateCommand(paths)).rejects.toThrow(/Suite file not found/);
  });

  it('throws when agent writes invalid JSON', async () => {
    const adapter = makeAdapter();
    adapter.interactive.mockResolvedValue({ exitCode: 0, durationMs: 1000 });
    vi.mocked(createAdapter).mockReturnValue(adapter as any);
    vi.mocked(readFile).mockResolvedValue('not json {{{');

    await expect(generateCommand(paths)).rejects.toThrow(/not valid JSON/);
  });
});