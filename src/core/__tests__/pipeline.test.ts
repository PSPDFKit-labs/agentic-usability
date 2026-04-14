import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { PipelineStateManager } from '../pipeline.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
}));

const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockUnlink = vi.mocked(unlink);

describe('PipelineStateManager', () => {
  let manager: PipelineStateManager;

  beforeEach(() => {
    manager = new PipelineStateManager('/working');
  });

  describe('constructor', () => {
    it('initializes with fresh state', () => {
      const state = manager.getState();
      expect(state.stage).toBe('generate');
      expect(state.completed.execute).toEqual([]);
    });
  });

  describe('load', () => {
    it('reads and parses state from disk', async () => {
      const savedState = {
        stage: 'execute',
        startedAt: '2024-01-01T00:00:00.000Z',
        testCases: 5,
        completed: { generate: ['TC-001'], execute: [], analyze: [], judge: [] },
      };
      mockReadFile.mockResolvedValue(JSON.stringify(savedState));
      const state = await manager.load();
      expect(state.stage).toBe('execute');
      expect(state.completed.generate).toEqual(['TC-001']);
    });

    it('returns fresh state when file does not exist', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      const state = await manager.load();
      expect(state.stage).toBe('generate');
    });

    it('returns fresh state when file contains invalid JSON', async () => {
      mockReadFile.mockResolvedValue('not json');
      const state = await manager.load();
      expect(state.stage).toBe('generate');
    });
  });

  describe('save', () => {
    it('writes current state to disk as JSON', async () => {
      await manager.save();
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('pipeline-state.json'),
        expect.any(String),
        'utf-8',
      );
    });
  });

  describe('markTestComplete', () => {
    it('adds testId to the specified stage', () => {
      manager.markTestComplete('execute', 'TC-001');
      expect(manager.getState().completed.execute).toContain('TC-001');
    });

    it('does not duplicate testId if already marked', () => {
      manager.markTestComplete('execute', 'TC-001');
      manager.markTestComplete('execute', 'TC-001');
      expect(manager.getState().completed.execute).toEqual(['TC-001']);
    });
  });

  describe('isTestComplete', () => {
    it('returns true for completed tests', () => {
      manager.markTestComplete('execute', 'TC-001');
      expect(manager.isTestComplete('execute', 'TC-001')).toBe(true);
    });

    it('returns false for incomplete tests', () => {
      expect(manager.isTestComplete('execute', 'TC-001')).toBe(false);
    });
  });

  describe('getIncompleteTests', () => {
    it('returns only tests not in the completed set', () => {
      manager.markTestComplete('execute', 'TC-001');
      const incomplete = manager.getIncompleteTests('execute', ['TC-001', 'TC-002', 'TC-003']);
      expect(incomplete).toEqual(['TC-002', 'TC-003']);
    });

    it('returns all tests when none are complete', () => {
      const incomplete = manager.getIncompleteTests('execute', ['TC-001', 'TC-002']);
      expect(incomplete).toEqual(['TC-001', 'TC-002']);
    });

    it('returns empty array when all are complete', () => {
      manager.markTestComplete('execute', 'TC-001');
      manager.markTestComplete('execute', 'TC-002');
      const incomplete = manager.getIncompleteTests('execute', ['TC-001', 'TC-002']);
      expect(incomplete).toEqual([]);
    });
  });

  describe('advanceStage', () => {
    it('updates the current stage', () => {
      manager.advanceStage('analyze');
      expect(manager.getState().stage).toBe('analyze');
    });
  });

  describe('reset', () => {
    it('resets state to fresh and deletes the state file', async () => {
      manager.markTestComplete('execute', 'TC-001');
      manager.advanceStage('analyze');
      await manager.reset();
      expect(manager.getState().stage).toBe('generate');
      expect(manager.getState().completed.execute).toEqual([]);
      expect(mockUnlink).toHaveBeenCalled();
    });

    it('does not throw if state file does not exist', async () => {
      mockUnlink.mockRejectedValue(new Error('ENOENT'));
      await expect(manager.reset()).resolves.toBeUndefined();
    });
  });
});
