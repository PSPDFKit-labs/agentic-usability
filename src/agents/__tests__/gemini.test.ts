import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawnAgent, spawnInteractive } from '../spawn.js';
import { GeminiAdapter } from '../gemini.js';
import { makeAgentResult } from '../../__tests__/helpers/fixtures.js';

vi.mock('../spawn.js', () => ({
  spawnAgent: vi.fn(),
  spawnInteractive: vi.fn(),
}));

const mockSpawnAgent = vi.mocked(spawnAgent);
const mockSpawnInteractive = vi.mocked(spawnInteractive);

describe('GeminiAdapter', () => {
  let adapter: GeminiAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GeminiAdapter({ command: 'gemini' });
  });

  describe('run', () => {
    it('spawns with --prompt, --output-format json, and --cwd', async () => {
      mockSpawnAgent.mockResolvedValue(makeAgentResult({ stdout: '{}' }));

      await adapter.run('prompt', {}, '/work');

      expect(mockSpawnAgent).toHaveBeenCalledWith('gemini', [
        '--prompt', 'prompt',
        '--output-format', 'json',
        '--cwd', '/work',
      ], { cwd: '/work', env: undefined });
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
        '--prompt', 'task', '--cwd', '/work',
      ], { cwd: '/work' });
      expect(result).toEqual({ exitCode: 0, durationMs: 5000 });
    });
  });

  describe('sandboxCommand', () => {
    it('returns shell command with --yolo', () => {
      const cmd = adapter.sandboxCommand('task');
      expect(cmd).toContain('gemini --yolo');
      expect(cmd).toContain('--cwd /workspace');
    });
  });

  describe('installCommand', () => {
    it('returns npm install command for gemini-cli', () => {
      expect(adapter.installCommand).toBe('npm i -g @google/gemini-cli');
    });
  });
});
