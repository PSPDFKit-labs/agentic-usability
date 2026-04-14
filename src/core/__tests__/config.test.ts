import { describe, it, expect, vi } from 'vitest';
import { readFile, mkdir, access } from 'node:fs/promises';
import { loadConfig, ensureWorkingDir } from '../config.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  mkdir: vi.fn(),
  access: vi.fn(),
}));

const mockReadFile = vi.mocked(readFile);
const mockMkdir = vi.mocked(mkdir);
const mockAccess = vi.mocked(access);

const validConfig = {
  source: { type: 'local', path: '/tmp/sdk' },
  targets: [{ name: 'claude', image: 'node:20' }],
  sandbox: { domain: 'localhost:8080' },
};

describe('loadConfig', () => {
  it('reads and parses a valid config file', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify(validConfig));
    const config = await loadConfig('/project');
    expect(config.source.type).toBe('local');
    expect(config.targets).toHaveLength(1);
  });

  it('throws when config file does not exist', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    await expect(loadConfig('/project')).rejects.toThrow(/Config file not found/);
  });

  it('throws when config file contains invalid JSON', async () => {
    mockReadFile.mockResolvedValue('not json {{{');
    await expect(loadConfig('/project')).rejects.toThrow(/Invalid JSON/);
  });

  it('throws when config is not an object (array)', async () => {
    mockReadFile.mockResolvedValue('[]');
    await expect(loadConfig('/project')).rejects.toThrow(/must be a JSON object/);
  });

  it('throws when config is not an object (string)', async () => {
    mockReadFile.mockResolvedValue('"hello"');
    await expect(loadConfig('/project')).rejects.toThrow(/must be a JSON object/);
  });

  it('throws when config is null', async () => {
    mockReadFile.mockResolvedValue('null');
    await expect(loadConfig('/project')).rejects.toThrow(/must be a JSON object/);
  });

  it('throws when source field is missing', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ targets: [], sandbox: {} }));
    await expect(loadConfig('/project')).rejects.toThrow(/source/);
  });

  it('throws when source.type is missing', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ source: {}, targets: [], sandbox: {} }));
    await expect(loadConfig('/project')).rejects.toThrow(/source\.type/);
  });

  it('throws when source.type is invalid', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ source: { type: 'ftp' }, targets: [{}], sandbox: { domain: 'x' } }));
    await expect(loadConfig('/project')).rejects.toThrow(/Invalid source\.type/);
  });

  it('throws when source.type is "local" but source.path is missing', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ source: { type: 'local' }, targets: [{}], sandbox: { domain: 'x' } }));
    await expect(loadConfig('/project')).rejects.toThrow(/source\.path/);
  });

  it('throws when source.type is "git" but source.url is missing', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ source: { type: 'git' }, targets: [{}], sandbox: { domain: 'x' } }));
    await expect(loadConfig('/project')).rejects.toThrow(/source\.url/);
  });

  it('throws when source.type is "url" but source.urls is missing', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ source: { type: 'url' }, targets: [{}], sandbox: { domain: 'x' } }));
    await expect(loadConfig('/project')).rejects.toThrow(/source\.urls/);
  });

  it('throws when source.type is "url" but source.urls is empty', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ source: { type: 'url', urls: [] }, targets: [{}], sandbox: { domain: 'x' } }));
    await expect(loadConfig('/project')).rejects.toThrow(/source\.urls/);
  });

  it('throws when targets array is missing', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ source: { type: 'local', path: '/x' }, sandbox: { domain: 'x' } }));
    await expect(loadConfig('/project')).rejects.toThrow(/targets/);
  });

  it('throws when targets array is empty', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ source: { type: 'local', path: '/x' }, targets: [], sandbox: { domain: 'x' } }));
    await expect(loadConfig('/project')).rejects.toThrow(/targets/);
  });

  it('throws when sandbox field is missing', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ source: { type: 'local', path: '/x' }, targets: [{}] }));
    await expect(loadConfig('/project')).rejects.toThrow(/sandbox/);
  });

  it('throws when sandbox.domain is missing', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ source: { type: 'local', path: '/x' }, targets: [{}], sandbox: {} }));
    await expect(loadConfig('/project')).rejects.toThrow(/sandbox\.domain/);
  });
});

describe('ensureWorkingDir', () => {
  it('returns the path to .agentic-usability directory', async () => {
    mockAccess.mockResolvedValue(undefined);
    const result = await ensureWorkingDir('/project');
    expect(result).toContain('.agentic-usability');
  });

  it('creates the directory if it does not exist', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    await ensureWorkingDir('/project');
    expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining('.agentic-usability'), { recursive: true });
  });

  it('does not throw if the directory already exists', async () => {
    mockAccess.mockResolvedValue(undefined);
    await expect(ensureWorkingDir('/project')).resolves.toContain('.agentic-usability');
  });
});
