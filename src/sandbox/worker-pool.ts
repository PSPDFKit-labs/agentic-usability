import type { TestCase } from '../core/types.js';

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

  constructor(concurrency = 3) {
    this.concurrency = Math.max(1, concurrency);
  }

  async run(
    testCases: TestCase[],
    executeFn: (testCase: TestCase) => Promise<void>,
    onProgress?: ProgressCallback,
  ): Promise<{ passed: number; failed: number }> {
    const total = testCases.length;
    const queue = [...testCases];
    let completed = 0;
    let failed = 0;
    let running = 0;

    const onShutdown = () => {
      this.aborted = true;
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
          try {
            await executeFn(tc);
            success = true;
            break;
          } catch (err) {
            if (attempt < maxRetries) {
              await sleep(backoffs[attempt]);
            } else {
              // Final attempt failed — record failure
              success = false;
              // Re-throw is not needed; we track via success flag
              // But we want the error available, so we store it on the last attempt
              const message = err instanceof Error ? err.message : String(err);
              // Save error info — caller's executeFn already handles saveResult
              // We just track the count here
              void message; // suppress unused
            }
          }
        }

        running--;
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

    return { passed: completed - failed, failed };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
