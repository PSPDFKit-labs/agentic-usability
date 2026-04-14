import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawnAgent, spawnInteractive } from '../spawn.js';
import { ClaudeAdapter } from '../claude.js';
import { makeAgentResult } from '../../__tests__/helpers/fixtures.js';

vi.mock('../spawn.js', () => ({
  spawnAgent: vi.fn(),
  spawnInteractive: vi.fn(),
}));

const mockSpawnAgent = vi.mocked(spawnAgent);
const mockSpawnInteractive = vi.mocked(spawnInteractive);

describe('ClaudeAdapter', () => {
  let adapter: ClaudeAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new ClaudeAdapter({ command: 'claude' });
  });

  describe('run', () => {
    it('returns clean result when adapter extracts structured_output from envelope', async () => {
      const envelope = { structured_output: { key: 'value' } };
      mockSpawnAgent.mockResolvedValue(makeAgentResult({ stdout: JSON.stringify(envelope) }));

      const result = await adapter.run('prompt', { type: 'object' }, '/work');

      expect(mockSpawnAgent).toHaveBeenCalledWith('claude', [
        '--print',
        '--output-format', 'json',
        '--json-schema', JSON.stringify({ type: 'object' }),
        'prompt',
      ], { cwd: '/work', env: undefined });
      expect(result.stdout).toBe(JSON.stringify({ key: 'value' }));
    });

    it('returns clean result when adapter extracts result field', async () => {
      const envelope = { result: 'text result' };
      mockSpawnAgent.mockResolvedValue(makeAgentResult({ stdout: JSON.stringify(envelope) }));

      const result = await adapter.run('prompt', {}, '/work');
      expect(result.stdout).toBe('text result');
    });

    it('retries when stdout is not valid JSON', async () => {
      mockSpawnAgent
        .mockResolvedValueOnce(makeAgentResult({ stdout: 'not json' }))
        .mockResolvedValueOnce(makeAgentResult({ stdout: JSON.stringify({ structured_output: { ok: true } }) }));

      const result = await adapter.run('prompt', {}, '/work', { retries: 1 });

      expect(mockSpawnAgent).toHaveBeenCalledTimes(2);
      expect(result.stdout).toBe(JSON.stringify({ ok: true }));
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

      const result = await adapter.interactive('do something', '/work');

      expect(mockSpawnInteractive).toHaveBeenCalledWith('claude', [
        'do something',
      ], { cwd: '/work' });
      expect(result).toEqual({ exitCode: 0, durationMs: 5000 });
    });
  });

  describe('sandboxCommand', () => {
    it('returns correct shell string with --dangerously-skip-permissions', () => {
      const cmd = adapter.sandboxCommand('do something');
      expect(cmd).toContain('cd /workspace && claude --print --dangerously-skip-permissions');
      expect(cmd).toContain('do something');
    });

    it('escapes single quotes', () => {
      const cmd = adapter.sandboxCommand("it's a test");
      expect(cmd).toContain("it'\\''s a test");
    });

    it('appends custom args', () => {
      const custom = new ClaudeAdapter({ command: 'claude', args: ['--verbose'] });
      const cmd = custom.sandboxCommand('prompt');
      expect(cmd).toContain('--verbose');
    });
  });

  describe('installCommand', () => {
    it('returns correct npm install command', () => {
      expect(adapter.installCommand).toBe('npm i -g @anthropic-ai/claude-code');
    });
  });
});
