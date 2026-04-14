import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkerPool, type ProgressCallback } from '../worker-pool.js';
import { makeTestCase } from '../../__tests__/helpers/fixtures.js';

describe('WorkerPool', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('run', () => {
    it('executes all test cases and returns passed/failed counts', async () => {
      const pool = new WorkerPool(2);
      const cases = [makeTestCase({ id: 'TC-001' }), makeTestCase({ id: 'TC-002' })];
      const executeFn = vi.fn().mockResolvedValue(undefined);

      const resultPromise = pool.run(cases, executeFn);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.passed).toBe(2);
      expect(result.failed).toBe(0);
      expect(executeFn).toHaveBeenCalledTimes(2);
    });

    it('reports a task as failed after exhausting retries', async () => {
      const pool = new WorkerPool(1);
      const executeFn = vi.fn().mockRejectedValue(new Error('fail'));

      const resultPromise = pool.run([makeTestCase()], executeFn);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.failed).toBe(1);
      expect(result.passed).toBe(0);
      // 1 initial + 2 retries = 3 total calls
      expect(executeFn).toHaveBeenCalledTimes(3);
    });

    it('retries failed tasks up to 2 times with backoff', async () => {
      const pool = new WorkerPool(1);
      let callCount = 0;
      const executeFn = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) throw new Error('transient');
      });

      const resultPromise = pool.run([makeTestCase()], executeFn);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.passed).toBe(1);
      expect(result.failed).toBe(0);
      expect(executeFn).toHaveBeenCalledTimes(3);
    });

    it('calls onProgress callback with start/done/fail events', async () => {
      const pool = new WorkerPool(1);
      const onProgress: ProgressCallback = vi.fn();
      const executeFn = vi.fn().mockResolvedValue(undefined);

      const resultPromise = pool.run([makeTestCase()], executeFn, onProgress);
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ total: 1 }),
        expect.any(Object),
        'start',
      );
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ total: 1 }),
        expect.any(Object),
        'done',
      );
    });

    it('handles empty test cases array', async () => {
      const pool = new WorkerPool(2);
      const executeFn = vi.fn();

      const resultPromise = pool.run([], executeFn);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.passed).toBe(0);
      expect(result.failed).toBe(0);
      expect(executeFn).not.toHaveBeenCalled();
    });

    it('enforces minimum concurrency of 1', async () => {
      const pool = new WorkerPool(0);
      const executeFn = vi.fn().mockResolvedValue(undefined);

      const resultPromise = pool.run([makeTestCase()], executeFn);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.passed).toBe(1);
    });

    it('reports correct ProgressInfo counts', async () => {
      const pool = new WorkerPool(1);
      const events: Array<{ event: string; info: any }> = [];
      const onProgress: ProgressCallback = (info, _tc, event) => {
        events.push({ event, info: { ...info } });
      };
      const executeFn = vi.fn().mockResolvedValue(undefined);

      const resultPromise = pool.run([makeTestCase({ id: 'TC-001' }), makeTestCase({ id: 'TC-002' })], executeFn, onProgress);
      await vi.runAllTimersAsync();
      await resultPromise;

      const startEvents = events.filter((e) => e.event === 'start');
      expect(startEvents).toHaveLength(2);
      expect(startEvents[0].info.total).toBe(2);
    });
  });
});
