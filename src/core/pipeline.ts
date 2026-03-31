import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { PipelineState } from './types.js';

const STATE_FILENAME = 'pipeline-state.json';

type PipelineStage = keyof PipelineState['completed'];

export class PipelineStateManager {
  private statePath: string;
  private state: PipelineState;

  constructor(workingDir: string) {
    this.statePath = join(workingDir, STATE_FILENAME);
    this.state = PipelineStateManager.freshState();
  }

  private static freshState(): PipelineState {
    return {
      stage: 'generate',
      startedAt: new Date().toISOString(),
      testCases: 0,
      completed: {
        generate: [],
        execute: [],
        analyze: [],
        judge: [],
      },
    };
  }

  async load(): Promise<PipelineState> {
    try {
      const raw = await readFile(this.statePath, 'utf-8');
      this.state = JSON.parse(raw) as PipelineState;
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

  markTestComplete(stage: PipelineStage, testId: string): void {
    if (!this.state.completed[stage].includes(testId)) {
      this.state.completed[stage].push(testId);
    }
  }

  advanceStage(stage: string): void {
    this.state.stage = stage;
  }

  isTestComplete(stage: PipelineStage, testId: string): boolean {
    return this.state.completed[stage].includes(testId);
  }

  getIncompleteTests(stage: PipelineStage, allTestIds: string[]): string[] {
    const completed = new Set(this.state.completed[stage]);
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
