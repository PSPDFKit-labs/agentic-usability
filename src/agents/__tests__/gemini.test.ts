import { describe, it, expect, vi, beforeEach } from 'vitest';
import { access } from 'node:fs/promises';
import { spawnAgent, spawnInteractive } from '../spawn.js';
import { uploadDirToSandbox } from '../../sandbox/scaffolding.js';
import { GeminiAdapter } from '../gemini.js';
import { makeAgentResult } from '../../__tests__/helpers/fixtures.js';
import { makeMockSandboxClient } from '../../__tests__/helpers/mock-sandbox-client.js';

vi.mock('../spawn.js', () => ({
  spawnAgent: vi.fn(),
  spawnInteractive: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
}));

vi.mock('../../sandbox/scaffolding.js', () => ({
  uploadDirToSandbox: vi.fn(),
}));

const mockSpawnAgent = vi.mocked(spawnAgent);
const mockSpawnInteractive = vi.mocked(spawnInteractive);
const mockAccess = vi.mocked(access);
const mockUploadDir = vi.mocked(uploadDirToSandbox);

describe('GeminiAdapter', () => {
  let adapter: GeminiAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GeminiAdapter({ command: 'gemini' });
  });

  describe('run', () => {
    it('spawns with -p, -o json', async () => {
      mockSpawnAgent.mockResolvedValue(makeAgentResult({ stdout: '{}' }));

      await adapter.run('prompt', {}, '/work');

      expect(mockSpawnAgent).toHaveBeenCalledWith('gemini', [
        '-o', 'json',
      ], { cwd: '/work', env: undefined, stdin: 'prompt' });
    });

    it('extracts response field from JSON envelope', async () => {
      const envelope = { response: 'extracted content' };
      mockSpawnAgent.mockResolvedValue(makeAgentResult({ stdout: JSON.stringify(envelope) }));

      const result = await adapter.run('prompt', {}, '/work');
      expect(result.stdout).toBe('extracted content');
    });

    it('retries when stdout is not valid JSON', async () => {
      mockSpawnAgent
        .mockResolvedValueOnce(makeAgentResult({ stdout: 'not json' }))
        .mockResolvedValueOnce(makeAgentResult({ stdout: JSON.stringify({ response: 'ok' }) }));

      const result = await adapter.run('prompt', {}, '/work', { retries: 1 });
      expect(mockSpawnAgent).toHaveBeenCalledTimes(2);
      expect(result.stdout).toBe('ok');
    });

    it('returns raw result after exhausting retries', async () => {
      mockSpawnAgent.mockResolvedValue(makeAgentResult({ stdout: 'not json' }));

      const result = await adapter.run('prompt', {}, '/work', { retries: 1 });
      expect(mockSpawnAgent).toHaveBeenCalledTimes(2);
      expect(result.stdout).toBe('not json');
    });
  });

  describe('interactive', () => {
    it('calls spawnInteractive with correct args and workDir', async () => {
      mockSpawnInteractive.mockResolvedValue({ exitCode: 0, durationMs: 5000 });

      const result = await adapter.interactive('task', '/work');

      expect(mockSpawnInteractive).toHaveBeenCalledWith('gemini', [
        '-i', 'task',
      ], { cwd: '/work' });
      expect(result).toEqual({ exitCode: 0, durationMs: 5000 });
    });
  });

  describe('sandboxCommand', () => {
    it('returns shell command without su wrapping', () => {
      const cmd = adapter.sandboxCommand('task');
      expect(cmd).toBe("cd /workspace && GEMINI_SANDBOX=false gemini --yolo -p 'task'");
    });

    it('includes -o json when schema is provided', () => {
      const schema = { type: 'object' };
      const cmd = adapter.sandboxCommand('task', '/workspace', schema);
      expect(cmd).toContain('-o json');
    });

    it('omits -o json when no schema is provided', () => {
      const cmd = adapter.sandboxCommand('task');
      expect(cmd).not.toContain('-o json');
    });
  });

  describe('extractResult', () => {
    it('unwraps response field from Gemini envelope', () => {
      const envelope = JSON.stringify({ response: 'extracted content' });
      expect(adapter.extractResult(envelope)).toBe('extracted content');
    });

    it('returns raw string when not valid JSON', () => {
      expect(adapter.extractResult('not json')).toBe('not json');
    });
  });

  describe('installCommand', () => {
    it('returns npm install command for gemini-cli', () => {
      expect(adapter.installCommand).toBe('npm i -g @google/gemini-cli');
    });
  });

  describe('installPluginsInSandbox', () => {
    it('is a no-op when given an empty plugin list', async () => {
      const client = makeMockSandboxClient();
      await adapter.installPluginsInSandbox(client as any, []);
      expect(client.runCommand).not.toHaveBeenCalled();
    });

    it('throws when a plugin has no gemini-extension.json manifest', async () => {
      mockAccess.mockRejectedValueOnce(new Error('ENOENT'));
      const client = makeMockSandboxClient();
      await expect(adapter.installPluginsInSandbox(client as any, [
        { name: 'noext', hostDir: '/tmp/noext' },
      ])).rejects.toThrow(/gemini-extension\.json/);
    });

    it('extracts each manifest-bearing plugin into ~/.gemini/extensions', async () => {
      mockAccess.mockResolvedValue(undefined);
      const client = makeMockSandboxClient();
      client.runCommand
        .mockResolvedValueOnce({ stdout: '/root', stderr: '', exitCode: 0 })  // printf HOME
        .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });            // mkdir

      await adapter.installPluginsInSandbox(client as any, [
        { name: 'ext-a', hostDir: '/tmp/a' },
        { name: 'ext-b', hostDir: '/tmp/b' },
      ]);

      expect(mockUploadDir).toHaveBeenCalledTimes(2);
      expect(mockUploadDir).toHaveBeenCalledWith(
        client,
        '/tmp/a',
        '/root/.gemini/extensions/ext-a',
        'gemini_ext_ext-a',
      );
      expect(mockUploadDir).toHaveBeenCalledWith(
        client,
        '/tmp/b',
        '/root/.gemini/extensions/ext-b',
        'gemini_ext_ext-b',
      );
    });
  });
});
