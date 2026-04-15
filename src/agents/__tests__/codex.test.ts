import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFile, readFile, rm } from 'node:fs/promises';
import { spawnAgent, spawnInteractive } from '../spawn.js';
import { CodexAdapter } from '../codex.js';
import { makeAgentResult } from '../../__tests__/helpers/fixtures.js';

vi.mock('../spawn.js', () => ({
  spawnAgent: vi.fn(),
  spawnInteractive: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
  rm: vi.fn().mockResolvedValue(undefined),
}));

const mockSpawnAgent = vi.mocked(spawnAgent);
const mockSpawnInteractive = vi.mocked(spawnInteractive);
const mockWriteFile = vi.mocked(writeFile);
const mockReadFile = vi.mocked(readFile);
const mockRm = vi.mocked(rm);

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
  });

  describe('installCommand', () => {
    it('returns npm install command for codex', () => {
      expect(adapter.installCommand).toBe('npm i -g @openai/codex');
    });
  });
});
