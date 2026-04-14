import { spawn } from 'node:child_process';
import { AgentResult } from '../core/types.js';

const DEFAULT_TIMEOUT = 300_000; // 5 minutes

/**
 * Spawn a command with stdio inherited so the user can interact with it directly.
 * Returns exit code and duration when the process exits.
 */
export function spawnInteractive(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: Record<string, string>;
  } = {}
): Promise<{ exitCode: number; durationMs: number }> {
  return new Promise((resolve) => {
    const start = Date.now();

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: 'inherit',
    });

    child.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        durationMs: Date.now() - start,
      });
    });

    child.on('error', (err) => {
      console.error(`Failed to spawn '${command}': ${err.message}`);
      resolve({
        exitCode: 1,
        durationMs: Date.now() - start,
      });
    });
  });
}

export function spawnAgent(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
  } = {}
): Promise<AgentResult> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;

  return new Promise((resolve) => {
    const start = Date.now();
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 5_000);
    }, timeout);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        exitCode: code ?? 1,
        durationMs: Date.now() - start,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        stdout: '',
        stderr: `Failed to spawn '${command}': ${err.message}`,
        exitCode: 1,
        durationMs: Date.now() - start,
      });
    });
  });
}
