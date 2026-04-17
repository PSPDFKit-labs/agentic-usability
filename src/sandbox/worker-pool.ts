import type { TestCase } from '../types.js';

export interface ProgressInfo {
  completed: number;
  running: number;
  queued: number;
  failed: number;
  total: number;
}

export type ProgressCallback = (info: ProgressInfo, testCase: TestCase, event: 'start' | 'done' | 'fail') => void;

export class WorkerPool {
  private concurrency: number;
  private aborted = false;
  private abortCallbacks = new Set<() => Promise<void>>();

  constructor(concurrency = 3) {
    this.concurrency = Math.max(1, concurrency);
  }

  /** Register a callback to be called on abort (e.g. destroy a sandbox). Returns an unregister function. */
  onAbort(callback: () => Promise<void>): () => void {
    this.abortCallbacks.add(callback);
    return () => { this.abortCallbacks.delete(callback); };
  }

  get isAborted(): boolean {
    return this.aborted;
  }

  async run(
    testCases: TestCase[],
    executeFn: (testCase: TestCase) => Promise<void>,
    onProgress?: ProgressCallback,
  ): Promise<{ passed: number; failed: number; aborted: boolean }> {
    const total = testCases.length;
    const queue = [...testCases];
    let completed = 0;
    let failed = 0;
    let running = 0;

    let sigintCount = 0;
    const onShutdown = () => {
      sigintCount++;
      if (sigintCount === 1) {
        this.aborted = true;
        // Destroy all active sandboxes to unblock in-flight tasks
        for (const cb of this.abortCallbacks) {
          cb().catch(() => {});
        }
        this.abortCallbacks.clear();
      } else {
        // Second Ctrl+C = force exit
        process.exit(1);
      }
    };
    process.on('SIGINT', onShutdown);

    const report = (tc: TestCase, event: 'start' | 'done' | 'fail') => {
      onProgress?.({
        completed,
        running,
        queued: queue.length,
        failed,
        total,
      }, tc, event);
    };

    const runOne = async (): Promise<void> => {
      while (queue.length > 0 && !this.aborted) {
        const tc = queue.shift()!;
        running++;
        report(tc, 'start');

        let success = false;
        const maxRetries = 2;
        const backoffs = [1000, 3000];

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          if (this.aborted) break;

          try {
            await executeFn(tc);
            success = true;
            break;
          } catch (err) {
            if (this.aborted) break;
            if (attempt < maxRetries) {
              await sleep(backoffs[attempt]);
            } else {
              success = false;
              const message = err instanceof Error ? err.message : String(err);
              void message;
            }
          }
        }

        running--;
        if (this.aborted) break;

        if (success) {
          completed++;
          report(tc, 'done');
        } else {
          failed++;
          completed++;
          report(tc, 'fail');
        }
      }
    };

    const workers: Promise<void>[] = [];
    for (let i = 0; i < this.concurrency; i++) {
      workers.push(runOne());
    }

    await Promise.all(workers);

    process.removeListener('SIGINT', onShutdown);

    return { passed: completed - failed, failed, aborted: this.aborted };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
