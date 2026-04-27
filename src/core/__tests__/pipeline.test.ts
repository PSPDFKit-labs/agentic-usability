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
    manager = new PipelineStateManager('/fake/project/logs/pipeline-state.json');
  });

  describe('constructor', () => {
    it('initializes with fresh state', () => {
      const state = manager.getState();
      expect(state.stage).toBe('execute');
      expect(state.completed.execute).toEqual({});
    });
  });

  describe('load', () => {
    it('reads and parses state from disk', async () => {
      const savedState = {
        stage: 'judge',
        startedAt: '2024-01-01T00:00:00.000Z',
        testCases: 5,
        completed: { execute: { claude: ['TC-001'] }, judge: {} },
      };
      mockReadFile.mockResolvedValue(JSON.stringify(savedState));
      const state = await manager.load();
      expect(state.stage).toBe('judge');
      expect(state.completed.execute).toEqual({ claude: ['TC-001'] });
    });

    it('migrates old flat-array format to per-target format', async () => {
      const savedState = {
        stage: 'judge',
        startedAt: '2024-01-01T00:00:00.000Z',
        testCases: 5,
        completed: { execute: ['TC-001', 'TC-002'], judge: [] },
      };
      mockReadFile.mockResolvedValue(JSON.stringify(savedState));
      const state = await manager.load();
      expect(state.completed.execute).toEqual({ _legacy: ['TC-001', 'TC-002'] });
      expect(state.completed.judge).toEqual({});
    });

    it('returns fresh state when file does not exist', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      const state = await manager.load();
      expect(state.stage).toBe('execute');
    });

    it('returns fresh state when file contains invalid JSON', async () => {
      mockReadFile.mockResolvedValue('not json');
      const state = await manager.load();
      expect(state.stage).toBe('execute');
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
    it('adds testId to the specified stage and target', () => {
      manager.markTestComplete('execute', 'TC-001', 'claude');
      expect(manager.getState().completed.execute.claude).toContain('TC-001');
    });

    it('does not duplicate testId if already marked', () => {
      manager.markTestComplete('execute', 'TC-001', 'claude');
      manager.markTestComplete('execute', 'TC-001', 'claude');
      expect(manager.getState().completed.execute.claude).toEqual(['TC-001']);
    });

    it('tracks targets independently', () => {
      manager.markTestComplete('execute', 'TC-001', 'claude');
      manager.markTestComplete('execute', 'TC-001', 'codex');
      expect(manager.getState().completed.execute.claude).toEqual(['TC-001']);
      expect(manager.getState().completed.execute.codex).toEqual(['TC-001']);
    });
  });

  describe('isTestComplete', () => {
    it('returns true for completed tests on a specific target', () => {
      manager.markTestComplete('execute', 'TC-001', 'claude');
      expect(manager.isTestComplete('execute', 'TC-001', 'claude')).toBe(true);
    });

    it('returns false for incomplete tests', () => {
      expect(manager.isTestComplete('execute', 'TC-001', 'claude')).toBe(false);
    });

    it('returns false for a different target', () => {
      manager.markTestComplete('execute', 'TC-001', 'claude');
      expect(manager.isTestComplete('execute', 'TC-001', 'codex')).toBe(false);
    });
  });

  describe('getIncompleteTests', () => {
    it('returns only tests not in the completed set for a target', () => {
      manager.markTestComplete('execute', 'TC-001', 'claude');
      const incomplete = manager.getIncompleteTests('execute', ['TC-001', 'TC-002', 'TC-003'], 'claude');
      expect(incomplete).toEqual(['TC-002', 'TC-003']);
    });

    it('returns all tests when none are complete for the target', () => {
      const incomplete = manager.getIncompleteTests('execute', ['TC-001', 'TC-002'], 'claude');
      expect(incomplete).toEqual(['TC-001', 'TC-002']);
    });

    it('returns all tests for a different target even if one target is done', () => {
      manager.markTestComplete('execute', 'TC-001', 'claude');
      manager.markTestComplete('execute', 'TC-002', 'claude');
      const incomplete = manager.getIncompleteTests('execute', ['TC-001', 'TC-002'], 'codex');
      expect(incomplete).toEqual(['TC-001', 'TC-002']);
    });

    it('returns empty array when all are complete for the target', () => {
      manager.markTestComplete('execute', 'TC-001', 'claude');
      manager.markTestComplete('execute', 'TC-002', 'claude');
      const incomplete = manager.getIncompleteTests('execute', ['TC-001', 'TC-002'], 'claude');
      expect(incomplete).toEqual([]);
    });
  });

  describe('advanceStage', () => {
    it('updates the current stage', () => {
      manager.advanceStage('judge');
      expect(manager.getState().stage).toBe('judge');
    });
  });

  describe('reset', () => {
    it('resets state to fresh and deletes the state file', async () => {
      manager.markTestComplete('execute', 'TC-001', 'claude');
      manager.advanceStage('judge');
      await manager.reset();
      expect(manager.getState().stage).toBe('execute');
      expect(manager.getState().completed.execute).toEqual({});
      expect(mockUnlink).toHaveBeenCalled();
    });

    it('does not throw if state file does not exist', async () => {
      mockUnlink.mockRejectedValue(new Error('ENOENT'));
      await expect(manager.reset()).resolves.toBeUndefined();
    });
  });
});
