import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFile, readFile, rm, access, readdir, stat } from 'node:fs/promises';
import { spawnAgent, spawnInteractive } from '../spawn.js';
import { uploadDirToSandbox } from '../../sandbox/scaffolding.js';
import { CodexAdapter } from '../codex.js';
import { makeAgentResult } from '../../__tests__/helpers/fixtures.js';
import { makeMockSandboxClient } from '../../__tests__/helpers/mock-sandbox-client.js';

vi.mock('../spawn.js', () => ({
  spawnAgent: vi.fn(),
  spawnInteractive: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
  rm: vi.fn().mockResolvedValue(undefined),
  access: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('../../sandbox/scaffolding.js', () => ({
  uploadDirToSandbox: vi.fn(),
}));

const mockSpawnAgent = vi.mocked(spawnAgent);
const mockSpawnInteractive = vi.mocked(spawnInteractive);
const mockWriteFile = vi.mocked(writeFile);
const mockReadFile = vi.mocked(readFile);
const mockRm = vi.mocked(rm);
const mockAccess = vi.mocked(access);
const mockReaddir = vi.mocked(readdir);
const mockStat = vi.mocked(stat);
const mockUploadDir = vi.mocked(uploadDirToSandbox);

describe('CodexAdapter', () => {
  let adapter: CodexAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new CodexAdapter({ command: 'codex' });
  });

  describe('run', () => {
    it('writes schema to temp file, spawns with --output-schema, reads output, cleans up', async () => {
      mockSpawnAgent.mockResolvedValue(makeAgentResult());
      mockReadFile.mockResolvedValue('{"result": true}');

      const result = await adapter.run('prompt', { type: 'object' }, '/work');

      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('codex-schema'),
        JSON.stringify({ type: 'object' }),
        'utf-8',
      );
      const call = mockSpawnAgent.mock.calls[0];
      expect(call[0]).toBe('codex');
      expect(call[1]).toEqual(expect.arrayContaining([
        'exec', '-C', '/work', '--full-auto', '--output-schema',
      ]));
      expect(call[1]).not.toContain('prompt');
      expect(call[2]).toEqual(expect.objectContaining({ stdin: 'prompt' }));
      expect(result.stdout).toBe('{"result": true}');
      expect(mockRm).toHaveBeenCalledTimes(2);
    });

    it('falls back to stdout when output file does not exist', async () => {
      mockSpawnAgent.mockResolvedValue(makeAgentResult({ stdout: '{"fallback": true}' }));
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      const result = await adapter.run('prompt', {}, '/work');
      expect(result.stdout).toBe('{"fallback": true}');
    });

    it('retries when stdout is not valid JSON', async () => {
      mockSpawnAgent
        .mockResolvedValueOnce(makeAgentResult({ stdout: 'not json' }))
        .mockResolvedValueOnce(makeAgentResult({ stdout: '{}' }));
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      const result = await adapter.run('prompt', {}, '/work', { retries: 1 });
      expect(mockSpawnAgent).toHaveBeenCalledTimes(2);
    });
  });

  describe('interactive', () => {
    it('calls spawnInteractive with correct args and workDir', async () => {
      mockSpawnInteractive.mockResolvedValue({ exitCode: 0, durationMs: 5000 });

      const result = await adapter.interactive('task', '/work');

      expect(mockSpawnInteractive).toHaveBeenCalledWith('codex', [
        'task',
      ], { cwd: '/work' });
      expect(result).toEqual({ exitCode: 0, durationMs: 5000 });
    });
  });

  describe('sandboxCommand', () => {
    it('returns shell command without su wrapping', () => {
      const cmd = adapter.sandboxCommand('task');
      expect(cmd).toBe("codex exec --dangerously-bypass-approvals-and-sandbox -C /workspace 'task'");
    });

    it('includes --output-schema flag when schema is provided', () => {
      const schema = { type: 'object', properties: { score: { type: 'number' } } };
      const cmd = adapter.sandboxCommand('task', '/workspace', schema);
      expect(cmd).toContain('--output-schema /tmp/_schema.json');
      expect(cmd).toContain("printf '%s'");
      expect(cmd).toContain('"type":"object"');
    });

    it('omits schema flags when no schema is provided', () => {
      const cmd = adapter.sandboxCommand('task');
      expect(cmd).not.toContain('--output-schema');
      expect(cmd).not.toContain('_schema.json');
    });
  });

  describe('extractResult', () => {
    it('returns parsed JSON as-is when valid', () => {
      expect(adapter.extractResult('{"score": 95}')).toBe('{"score": 95}');
    });

    it('returns raw string when not valid JSON', () => {
      expect(adapter.extractResult('not json')).toBe('not json');
    });
  });

  describe('installCommand', () => {
    it('returns npm install command for codex', () => {
      expect(adapter.installCommand).toBe('npm i -g @openai/codex@0.93.0');
    });
  });

  describe('installPluginsInSandbox', () => {
    function makeDirent(name: string, isDir: boolean) {
      return {
        name,
        isDirectory: () => isDir,
        isFile: () => !isDir,
      } as any;
    }

    it('is a no-op when given an empty plugin list', async () => {
      const client = makeMockSandboxClient();
      await adapter.installPluginsInSandbox(client as any, []);
      expect(client.runCommand).not.toHaveBeenCalled();
    });

    it('throws when a plugin is missing its Codex manifest', async () => {
      mockAccess.mockRejectedValueOnce(new Error('ENOENT'));
      const client = makeMockSandboxClient();
      await expect(adapter.installPluginsInSandbox(client as any, [
        { name: 'broken', hostDir: '/tmp/broken' },
      ])).rejects.toThrow(/\.codex-plugin\/plugin\.json/);
      expect(mockUploadDir).not.toHaveBeenCalled();
    });

    it('throws when a plugin has no skills/ directory', async () => {
      mockAccess.mockResolvedValueOnce(undefined);
      mockReaddir.mockRejectedValueOnce(new Error('ENOENT'));
      const client = makeMockSandboxClient();
      await expect(adapter.installPluginsInSandbox(client as any, [
        { name: 'empty', hostDir: '/tmp/empty' },
      ])).rejects.toThrow(/no 'skills\/' directory/);
    });

    it('throws when a plugin contributes no SKILL.md-bearing dirs', async () => {
      mockAccess.mockResolvedValueOnce(undefined);
      mockReaddir.mockResolvedValueOnce([
        makeDirent('not-a-skill', true),
      ]);
      mockStat.mockRejectedValueOnce(new Error('ENOENT'));
      const client = makeMockSandboxClient();
      await expect(adapter.installPluginsInSandbox(client as any, [
        { name: 'shell', hostDir: '/tmp/shell' },
      ])).rejects.toThrow(/no usable Codex skills/);
    });

    it('extracts each plugin skill into $CODEX_HOME/skills/<name>', async () => {
      mockAccess.mockResolvedValue(undefined);
      // One plugin with two skills.
      mockReaddir.mockResolvedValueOnce([
        makeDirent('skill-one', true),
        makeDirent('skill-two', true),
        makeDirent('not-a-dir', false),
      ]);
      mockStat.mockResolvedValue({ isFile: () => true } as any);

      const client = makeMockSandboxClient();
      client.runCommand
        .mockResolvedValueOnce({ stdout: '/root/.codex', stderr: '', exitCode: 0 }) // printf CODEX_HOME
        .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });                  // mkdir, etc.

      await adapter.installPluginsInSandbox(client as any, [
        { name: 'bundle', hostDir: '/tmp/bundle' },
      ]);

      expect(mockUploadDir).toHaveBeenCalledTimes(2);
      expect(mockUploadDir).toHaveBeenCalledWith(
        client,
        expect.stringContaining('skills/skill-one'),
        '/root/.codex/skills/skill-one',
        'codex_skill_skill-one',
      );
      expect(mockUploadDir).toHaveBeenCalledWith(
        client,
        expect.stringContaining('skills/skill-two'),
        '/root/.codex/skills/skill-two',
        'codex_skill_skill-two',
      );
    });

    it('throws when two plugins contribute the same skill name, naming both', async () => {
      mockAccess.mockResolvedValue(undefined);
      // Two plugins, each contributing a skill called 'shared'.
      mockReaddir
        .mockResolvedValueOnce([makeDirent('shared', true)])
        .mockResolvedValueOnce([makeDirent('shared', true)]);
      mockStat.mockResolvedValue({ isFile: () => true } as any);

      const client = makeMockSandboxClient();
      client.runCommand.mockResolvedValue({ stdout: '/root/.codex', stderr: '', exitCode: 0 });

      await expect(adapter.installPluginsInSandbox(client as any, [
        { name: 'plugin-a', hostDir: '/tmp/a' },
        { name: 'plugin-b', hostDir: '/tmp/b' },
      ])).rejects.toThrow(/'plugin-a'.*'plugin-b'/);
    });
  });
});
