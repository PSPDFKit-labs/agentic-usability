import { readFile, writeFile, unlink } from 'node:fs/promises';
import { PipelineState } from '../types.js';

type PipelineStage = keyof PipelineState['completed'];

export class PipelineStateManager {
  private statePath: string;
  private state: PipelineState;

  constructor(statePath: string) {
    this.statePath = statePath;
    this.state = PipelineStateManager.freshState();
  }

  private static freshState(): PipelineState {
    return {
      stage: 'execute',
      startedAt: new Date().toISOString(),
      testCases: 0,
      completed: {
        execute: {},
        judge: {},
      },
    };
  }

  async load(): Promise<PipelineState> {
    try {
      const raw = await readFile(this.statePath, 'utf-8');
      const parsed = JSON.parse(raw) as PipelineState;
      // Ensure all completed stages exist (guards against older state files)
      const fresh = PipelineStateManager.freshState();
      parsed.completed = {
        ...fresh.completed,
        ...parsed.completed,
      };
      // Migrate old format: if a stage value is a flat string[] (pre-target tracking),
      // convert it to a Record with a single '_legacy' key so existing completions are preserved.
      for (const stage of ['execute', 'judge'] as const) {
        const val = parsed.completed[stage];
        if (Array.isArray(val)) {
          parsed.completed[stage] = (val as string[]).length > 0 ? { _legacy: val as string[] } : {};
        }
      }
      this.state = parsed;
    } catch {
      this.state = PipelineStateManager.freshState();
    }
    return this.state;
  }

  async save(): Promise<void> {
    await writeFile(this.statePath, JSON.stringify(this.state, null, 2) + '\n', 'utf-8');
  }

  getState(): PipelineState {
    return this.state;
  }

  markTestComplete(stage: PipelineStage, testId: string, target: string): void {
    const targetArr = this.state.completed[stage][target] ??= [];
    if (!targetArr.includes(testId)) {
      targetArr.push(testId);
    }
  }

  advanceStage(stage: string): void {
    this.state.stage = stage;
  }

  isTestComplete(stage: PipelineStage, testId: string, target: string): boolean {
    return this.state.completed[stage][target]?.includes(testId) ?? false;
  }

  getIncompleteTests(stage: PipelineStage, allTestIds: string[], target: string): string[] {
    const completed = new Set(this.state.completed[stage][target] ?? []);
    return allTestIds.filter((id) => !completed.has(id));
  }

  async reset(): Promise<void> {
    this.state = PipelineStateManager.freshState();
    try {
      await unlink(this.statePath);
    } catch {
      // File may not exist — that's fine
    }
  }
}
