import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawn } from 'node:child_process';
import { spawnAgent } from '../spawn.js';
import { makeMockChildProcess } from '../../__tests__/helpers/mock-child-process.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

const mockSpawn = vi.mocked(spawn);

describe('spawnAgent', () => {
  it('resolves with stdout, stderr, exitCode, and durationMs on success', async () => {
    mockSpawn.mockReturnValue(makeMockChildProcess({
      stdout: 'hello',
      stderr: 'warn',
      exitCode: 0,
    }));

    const result = await spawnAgent('echo', ['hello']);
    expect(result.stdout).toBe('hello');
    expect(result.stderr).toBe('warn');
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('resolves with exit code 1 and error stderr on spawn error', async () => {
    mockSpawn.mockReturnValue(makeMockChildProcess({
      error: new Error('command not found'),
    }));

    const result = await spawnAgent('nonexistent', []);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('command not found');
    expect(result.stdout).toBe('');
  });

  it('passes cwd option to spawn', async () => {
    mockSpawn.mockReturnValue(makeMockChildProcess({ exitCode: 0 }));

    await spawnAgent('echo', [], { cwd: '/tmp' });
    expect(mockSpawn).toHaveBeenCalledWith('echo', [], expect.objectContaining({
      cwd: '/tmp',
    }));
  });

  it('merges options.env with process.env', async () => {
    mockSpawn.mockReturnValue(makeMockChildProcess({ exitCode: 0 }));

    await spawnAgent('echo', [], { env: { CUSTOM: 'value' } });
    // The spawn function spreads process.env and custom env into one object
    expect(mockSpawn).toHaveBeenCalledWith(
      'echo', [],
      expect.objectContaining({
        env: expect.objectContaining({ CUSTOM: 'value' }),
      }),
    );
  });
});
