import { EventEmitter } from 'node:events';
import { vi } from 'vitest';

export function makeMockChildProcess(opts: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: Error;
}) {
  const child = new EventEmitter() as any;
  const stdoutEmitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();
  child.stdout = stdoutEmitter;
  child.stderr = stderrEmitter;
  child.kill = vi.fn();
  child.killed = false;

  if (opts.error) {
    queueMicrotask(() => child.emit('error', opts.error));
  } else {
    queueMicrotask(() => {
      if (opts.stdout) stdoutEmitter.emit('data', Buffer.from(opts.stdout));
      if (opts.stderr) stderrEmitter.emit('data', Buffer.from(opts.stderr));
      child.emit('close', opts.exitCode ?? 0);
    });
  }

  return child;
}
