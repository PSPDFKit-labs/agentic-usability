import { describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { loadConfig } from '../config.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

const mockReadFile = vi.mocked(readFile);

const validConfig = {
  sources: [{ type: 'local', path: '/tmp/sdk' }],
  targets: [{ name: 'claude', image: 'node:20' }],
  sandbox: { domain: 'localhost:8080' },
};

describe('loadConfig', () => {
  it('reads and parses a valid config file', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify(validConfig));
    const config = await loadConfig('/fake/config.json');
    expect(config.sources[0].type).toBe('local');
    expect(config.targets).toHaveLength(1);
  });

  it('throws when config file does not exist', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    await expect(loadConfig('/fake/config.json')).rejects.toThrow(/Config file not found/);
  });

  it('throws when config file contains invalid JSON', async () => {
    mockReadFile.mockResolvedValue('not json {{{');
    await expect(loadConfig('/fake/config.json')).rejects.toThrow(/Invalid JSON/);
  });

  it('throws when config is not an object (array)', async () => {
    mockReadFile.mockResolvedValue('[]');
    await expect(loadConfig('/fake/config.json')).rejects.toThrow(/must be a JSON object/);
  });

  it('throws when config is not an object (string)', async () => {
    mockReadFile.mockResolvedValue('"hello"');
    await expect(loadConfig('/fake/config.json')).rejects.toThrow(/must be a JSON object/);
  });

  it('throws when config is null', async () => {
    mockReadFile.mockResolvedValue('null');
    await expect(loadConfig('/fake/config.json')).rejects.toThrow(/must be a JSON object/);
  });

  it('throws when sources field is missing', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ targets: [{}], sandbox: { domain: 'x' } }));
    await expect(loadConfig('/fake/config.json')).rejects.toThrow(/sources/);
  });

  it('throws when sources is empty array', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ sources: [], targets: [{}], sandbox: { domain: 'x' } }));
    await expect(loadConfig('/fake/config.json')).rejects.toThrow(/sources/);
  });

  it('throws when sources entry is missing type', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ sources: [{}], targets: [{}], sandbox: { domain: 'x' } }));
    await expect(loadConfig('/fake/config.json')).rejects.toThrow(/type/);
  });

  it('throws when sources entry has invalid type', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ sources: [{ type: 'ftp' }], targets: [{}], sandbox: { domain: 'x' } }));
    await expect(loadConfig('/fake/config.json')).rejects.toThrow(/invalid/i);
  });

  it('throws when local source is missing path', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ sources: [{ type: 'local' }], targets: [{}], sandbox: { domain: 'x' } }));
    await expect(loadConfig('/fake/config.json')).rejects.toThrow(/path/);
  });

  it('throws when git source is missing url', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ sources: [{ type: 'git' }], targets: [{}], sandbox: { domain: 'x' } }));
    await expect(loadConfig('/fake/config.json')).rejects.toThrow(/url/);
  });

  it('throws when url source is missing url', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ sources: [{ type: 'url' }], targets: [{}], sandbox: { domain: 'x' } }));
    await expect(loadConfig('/fake/config.json')).rejects.toThrow(/url/);
  });

  it('validates multiple sources', async () => {
    const config = {
      sources: [
        { type: 'local', path: '/tmp/sdk' },
        { type: 'url', url: 'https://docs.example.com' },
      ],
      targets: [{ name: 'claude', image: 'node:20' }],
      sandbox: { domain: 'localhost:8080' },
    };
    mockReadFile.mockResolvedValue(JSON.stringify(config));
    const result = await loadConfig('/fake/config.json');
    expect(result.sources).toHaveLength(2);
  });

  it('throws when targets array is missing', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ sources: [{ type: 'local', path: '/x' }], sandbox: { domain: 'x' } }));
    await expect(loadConfig('/fake/config.json')).rejects.toThrow(/targets/);
  });

  it('throws when targets array is empty', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ sources: [{ type: 'local', path: '/x' }], targets: [], sandbox: { domain: 'x' } }));
    await expect(loadConfig('/fake/config.json')).rejects.toThrow(/targets/);
  });

  it('throws when sandbox field is missing', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ sources: [{ type: 'local', path: '/x' }], targets: [{}] }));
    await expect(loadConfig('/fake/config.json')).rejects.toThrow(/sandbox/);
  });

  it('throws when sandbox.domain is missing', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ sources: [{ type: 'local', path: '/x' }], targets: [{}], sandbox: {} }));
    await expect(loadConfig('/fake/config.json')).rejects.toThrow(/sandbox\.domain/);
  });
});
