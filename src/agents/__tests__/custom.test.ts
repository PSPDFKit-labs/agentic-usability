import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawnAgent, spawnInteractive } from '../spawn.js';
import { CustomAdapter } from '../custom.js';
import { makeAgentResult } from '../../__tests__/helpers/fixtures.js';

vi.mock('../spawn.js', () => ({
  spawnAgent: vi.fn(),
  spawnInteractive: vi.fn(),
}));

const mockSpawnAgent = vi.mocked(spawnAgent);
const mockSpawnInteractive = vi.mocked(spawnInteractive);

describe('CustomAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has name "custom:<command>"', () => {
    const adapter = new CustomAdapter({ command: 'my-agent' });
    expect(adapter.name).toBe('custom:my-agent');
  });

  describe('run', () => {
    it('replaces {prompt} and {workDir} placeholders in args', async () => {
      const adapter = new CustomAdapter({ command: 'my-agent', args: ['--input', '{prompt}', '--dir', '{workDir}'] });
      mockSpawnAgent.mockResolvedValue(makeAgentResult({ stdout: '{"ok": true}' }));

      await adapter.run('hello world', {}, '/workspace');

      expect(mockSpawnAgent).toHaveBeenCalledWith('my-agent', [
        '--input', 'hello world', '--dir', '/workspace',
      ], expect.any(Object));
    });

    it('passes command and empty args to spawnAgent when no args configured', async () => {
      const adapter = new CustomAdapter({ command: 'tool' });
      mockSpawnAgent.mockResolvedValue(makeAgentResult({ stdout: '{}' }));

      await adapter.run('prompt', {}, '/work');
      expect(mockSpawnAgent).toHaveBeenCalledWith('tool', [], expect.objectContaining({ cwd: '/work' }));
    });

    it('uses pipedArgs when configured, ignoring base args', async () => {
      const adapter = new CustomAdapter({
        command: 'tool',
        args: ['--base', '{prompt}'],
        pipedArgs: ['--json', '--prompt', '{prompt}', '--cwd', '{workDir}'],
      });
      mockSpawnAgent.mockResolvedValue(makeAgentResult({ stdout: '{"ok": true}' }));

      await adapter.run('hello', {}, '/work');
      expect(mockSpawnAgent).toHaveBeenCalledWith('tool', [
        '--json', '--prompt', 'hello', '--cwd', '/work',
      ], expect.any(Object));
    });

    it('retries when stdout is not valid JSON', async () => {
      const adapter = new CustomAdapter({ command: 'tool', args: ['{prompt}'] });
      mockSpawnAgent
        .mockResolvedValueOnce(makeAgentResult({ stdout: 'not json' }))
        .mockResolvedValueOnce(makeAgentResult({ stdout: '{"ok": true}' }));

      const result = await adapter.run('prompt', {}, '/work', { retries: 1 });
      expect(mockSpawnAgent).toHaveBeenCalledTimes(2);
      expect(result.stdout).toBe('{"ok": true}');
    });

    it('returns raw result after exhausting retries', async () => {
      const adapter = new CustomAdapter({ command: 'tool', args: ['{prompt}'] });
      mockSpawnAgent.mockResolvedValue(makeAgentResult({ stdout: 'not json' }));

      const result = await adapter.run('prompt', {}, '/work', { retries: 1 });
      expect(mockSpawnAgent).toHaveBeenCalledTimes(2);
      expect(result.stdout).toBe('not json');
    });
  });

  describe('interactive', () => {
    it('calls spawnInteractive with template-substituted args', async () => {
      const adapter = new CustomAdapter({ command: 'tool', args: ['--input', '{prompt}', '--dir', '{workDir}'] });
      mockSpawnInteractive.mockResolvedValue({ exitCode: 0, durationMs: 5000 });

      const result = await adapter.interactive('hello', '/work');

      expect(mockSpawnInteractive).toHaveBeenCalledWith('tool', [
        '--input', 'hello', '--dir', '/work',
      ], { cwd: '/work' });
      expect(result).toEqual({ exitCode: 0, durationMs: 5000 });
    });

    it('calls spawnInteractive with empty args when no args configured', async () => {
      const adapter = new CustomAdapter({ command: 'tool' });
      mockSpawnInteractive.mockResolvedValue({ exitCode: 0, durationMs: 5000 });

      await adapter.interactive('prompt', '/work');
      expect(mockSpawnInteractive).toHaveBeenCalledWith('tool', [], { cwd: '/work' });
    });

    it('uses interactiveArgs when configured, ignoring base args', async () => {
      const adapter = new CustomAdapter({
        command: 'tool',
        args: ['--base', '{prompt}'],
        interactiveArgs: ['--chat', '{prompt}', '--dir', '{workDir}'],
      });
      mockSpawnInteractive.mockResolvedValue({ exitCode: 0, durationMs: 5000 });

      await adapter.interactive('hello', '/work');
      expect(mockSpawnInteractive).toHaveBeenCalledWith('tool', [
        '--chat', 'hello', '--dir', '/work',
      ], { cwd: '/work' });
    });
  });

  describe('sandboxCommand', () => {
    it('substitutes {prompt} (escaped) and {workDir} (/workspace) and wraps with su', () => {
      const adapter = new CustomAdapter({ command: 'tool', args: ['--dir', '{workDir}', '{prompt}'] });
      const cmd = adapter.sandboxCommand('task');
      expect(cmd).toMatch(/^su -p sandbox -c '/);
      expect(cmd).toContain('tool');
      expect(cmd).toContain('/workspace');
    });

    it('wraps command with su when no args', () => {
      const adapter = new CustomAdapter({ command: 'tool' });
      expect(adapter.sandboxCommand('task')).toBe("su -p sandbox -c 'tool'");
    });
  });

  describe('installCommand', () => {
    it('returns null when not configured', () => {
      const adapter = new CustomAdapter({ command: 'my-tool' });
      expect(adapter.installCommand).toBeNull();
    });

    it('returns configured installCommand', () => {
      const adapter = new CustomAdapter({ command: 'my-tool', installCommand: 'pip install my-tool' });
      expect(adapter.installCommand).toBe('pip install my-tool');
    });
  });

  describe('sandboxArgs', () => {
    it('appends sandboxArgs to sandbox command', () => {
      const adapter = new CustomAdapter({
        command: 'my-tool',
        args: ['{prompt}'],
        sandboxArgs: ['--no-confirm', '--unsafe'],
      });
      const cmd = adapter.sandboxCommand('task');
      expect(cmd).toContain('--no-confirm');
      expect(cmd).toContain('--unsafe');
    });
  });

  describe('envelope', () => {
    it('extracts configured envelope field from JSON stdout', async () => {
      const adapter = new CustomAdapter({ command: 'tool', envelope: 'output' });
      mockSpawnAgent.mockResolvedValue(makeAgentResult({
        stdout: JSON.stringify({ output: { data: 'hello' } }),
      }));

      const result = await adapter.run('prompt', {}, '/work');
      expect(result.stdout).toBe(JSON.stringify({ data: 'hello' }));
    });

    it('extracts string envelope field as-is', async () => {
      const adapter = new CustomAdapter({ command: 'tool', envelope: 'text' });
      mockSpawnAgent.mockResolvedValue(makeAgentResult({
        stdout: JSON.stringify({ text: 'raw output here' }),
      }));

      const result = await adapter.run('prompt', {}, '/work');
      expect(result.stdout).toBe('raw output here');
    });

    it('skips parsing when envelope is "none"', async () => {
      const adapter = new CustomAdapter({ command: 'tool', envelope: 'none' });
      mockSpawnAgent.mockResolvedValue(makeAgentResult({ stdout: 'not json at all' }));

      const result = await adapter.run('prompt', {}, '/work');
      // Should NOT retry — "none" means raw output is fine
      expect(mockSpawnAgent).toHaveBeenCalledTimes(1);
      expect(result.stdout).toBe('not json at all');
    });
  });

  describe('timeout', () => {
    it('passes configured timeout to spawn', async () => {
      const adapter = new CustomAdapter({ command: 'tool', timeout: 60000 });
      mockSpawnAgent.mockResolvedValue(makeAgentResult({ stdout: '{}' }));

      await adapter.run('prompt', {}, '/work');
      expect(mockSpawnAgent).toHaveBeenCalledWith('tool', [], expect.objectContaining({ timeout: 60000 }));
    });
  });
});
