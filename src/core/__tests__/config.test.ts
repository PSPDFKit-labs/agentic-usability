import { describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { loadConfig } from '../config.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

const mockReadFile = vi.mocked(readFile);

const validConfig = {
  privateInfo: [{ type: 'local', path: '/tmp/sdk' }],
  targets: [{ name: 'claude', image: 'node:20' }],
  sandbox: {},
};

describe('loadConfig', () => {
  it('reads and parses a valid config file', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify(validConfig));
    const config = await loadConfig('/fake/config.json');
    expect(config.privateInfo[0].type).toBe('local');
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

  it('throws when privateInfo field is missing', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ targets: [{}], sandbox: {} }));
    await expect(loadConfig('/fake/config.json')).rejects.toThrow(/privateInfo/);
  });

  it('throws when privateInfo is empty array', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ privateInfo: [], targets: [{}], sandbox: {} }));
    await expect(loadConfig('/fake/config.json')).rejects.toThrow(/privateInfo/);
  });

  it('throws when privateInfo entry is missing type', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ privateInfo: [{}], targets: [{}], sandbox: {} }));
    await expect(loadConfig('/fake/config.json')).rejects.toThrow(/type/);
  });

  it('throws when privateInfo entry has invalid type', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ privateInfo: [{ type: 'ftp' }], targets: [{}], sandbox: {} }));
    await expect(loadConfig('/fake/config.json')).rejects.toThrow(/invalid/i);
  });

  it('throws when local source is missing path', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ privateInfo: [{ type: 'local' }], targets: [{}], sandbox: {} }));
    await expect(loadConfig('/fake/config.json')).rejects.toThrow(/path/);
  });

  it('throws when git source is missing url', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ privateInfo: [{ type: 'git' }], targets: [{}], sandbox: {} }));
    await expect(loadConfig('/fake/config.json')).rejects.toThrow(/url/);
  });

  it('throws when url source is missing url', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ privateInfo: [{ type: 'url' }], targets: [{}], sandbox: {} }));
    await expect(loadConfig('/fake/config.json')).rejects.toThrow(/url/);
  });

  it('throws when package source is missing name', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ privateInfo: [{ type: 'package' }], targets: [{}], sandbox: {} }));
    await expect(loadConfig('/fake/config.json')).rejects.toThrow(/name/);
  });

  it('accepts package source with name', async () => {
    const config = {
      privateInfo: [{ type: 'local', path: '/tmp/sdk' }],
      publicInfo: [{ type: 'package', name: 'my-sdk' }],
      targets: [{ name: 'claude', image: 'node:20' }],
      sandbox: {},
    };
    mockReadFile.mockResolvedValue(JSON.stringify(config));
    const result = await loadConfig('/fake/config.json');
    expect(result.publicInfo).toHaveLength(1);
  });

  it('validates multiple sources', async () => {
    const config = {
      privateInfo: [
        { type: 'local', path: '/tmp/sdk' },
        { type: 'url', url: 'https://docs.example.com' },
      ],
      targets: [{ name: 'claude', image: 'node:20' }],
      sandbox: {},
    };
    mockReadFile.mockResolvedValue(JSON.stringify(config));
    const result = await loadConfig('/fake/config.json');
    expect(result.privateInfo).toHaveLength(2);
  });

  it('validates publicInfo entries', async () => {
    const config = {
      privateInfo: [{ type: 'local', path: '/tmp/sdk' }],
      publicInfo: [{ type: 'invalid' }],
      targets: [{ name: 'claude', image: 'node:20' }],
      sandbox: {},
    };
    mockReadFile.mockResolvedValue(JSON.stringify(config));
    await expect(loadConfig('/fake/config.json')).rejects.toThrow(/invalid/i);
  });

  it('throws when targets array is missing', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ privateInfo: [{ type: 'local', path: '/x' }], sandbox: {} }));
    await expect(loadConfig('/fake/config.json')).rejects.toThrow(/targets/);
  });

  it('throws when targets array is empty', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ privateInfo: [{ type: 'local', path: '/x' }], targets: [], sandbox: {} }));
    await expect(loadConfig('/fake/config.json')).rejects.toThrow(/targets/);
  });

  it('throws when sandbox field is missing', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ privateInfo: [{ type: 'local', path: '/x' }], targets: [{}] }));
    await expect(loadConfig('/fake/config.json')).rejects.toThrow(/sandbox/);
  });

  it('accepts known agent with minimal secret (only value)', async () => {
    const config = {
      ...validConfig,
      agents: {
        judge: { command: 'claude', secret: { value: '$ANTHROPIC_API_KEY' } },
      },
    };
    mockReadFile.mockResolvedValue(JSON.stringify(config));
    const result = await loadConfig('/fake/config.json');
    // Defaults should be filled in
    expect(result.agents?.judge?.secret.envVar).toBe('ANTHROPIC_API_KEY');
    expect(result.agents?.judge?.secret.baseUrl).toBe('https://api.anthropic.com');
    expect(result.agents?.judge?.secret.baseUrlEnvVar).toBe('ANTHROPIC_BASE_URL');
  });

  it('accepts known agent with all secret fields explicit', async () => {
    const config = {
      ...validConfig,
      agents: {
        judge: {
          command: 'claude',
          secret: { envVar: 'ANTHROPIC_API_KEY', value: '$ANTHROPIC_API_KEY', baseUrl: 'https://api.anthropic.com' },
        },
      },
    };
    mockReadFile.mockResolvedValue(JSON.stringify(config));
    const result = await loadConfig('/fake/config.json');
    expect(result.agents?.judge?.secret.envVar).toBe('ANTHROPIC_API_KEY');
  });

  it('throws when sandbox agent (executor) is missing secret', async () => {
    const config = {
      ...validConfig,
      agents: { executor: { command: 'claude' } },
    };
    mockReadFile.mockResolvedValue(JSON.stringify(config));
    await expect(loadConfig('/fake/config.json')).rejects.toThrow(/secret/);
  });

  it('does not require secret for generator', async () => {
    const config = {
      ...validConfig,
      agents: { generator: { command: 'claude' } },
    };
    mockReadFile.mockResolvedValue(JSON.stringify(config));
    const result = await loadConfig('/fake/config.json');
    expect(result.agents?.generator?.command).toBe('claude');
  });

  it('throws when custom agent secret is missing envVar', async () => {
    const config = {
      ...validConfig,
      agents: { judge: { command: 'my-tool', secret: { value: 'key' } } },
    };
    mockReadFile.mockResolvedValue(JSON.stringify(config));
    await expect(loadConfig('/fake/config.json')).rejects.toThrow(/envVar.*required/);
  });

  it('throws when custom agent secret is missing baseUrl', async () => {
    const config = {
      ...validConfig,
      agents: { judge: { command: 'my-tool', secret: { value: 'key', envVar: 'MY_KEY' } } },
    };
    mockReadFile.mockResolvedValue(JSON.stringify(config));
    await expect(loadConfig('/fake/config.json')).rejects.toThrow(/baseUrl.*required/);
  });

  it('throws when agent secret is missing value', async () => {
    const config = {
      ...validConfig,
      agents: { judge: { command: 'claude', secret: { envVar: 'KEY' } } },
    };
    mockReadFile.mockResolvedValue(JSON.stringify(config));
    await expect(loadConfig('/fake/config.json')).rejects.toThrow(/value/);
  });

  it('throws when agent secret has invalid baseUrl', async () => {
    const config = {
      ...validConfig,
      agents: { judge: { command: 'claude', secret: { envVar: 'KEY', value: 'val', baseUrl: 'not-a-url' } } },
    };
    mockReadFile.mockResolvedValue(JSON.stringify(config));
    await expect(loadConfig('/fake/config.json')).rejects.toThrow(/valid URL/);
  });
});
