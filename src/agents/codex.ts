import { AgentConfig, AgentResult } from '../core/types.js';
import { AgentAdapter } from './adapter.js';
import { spawnAgent } from './spawn.js';

export class CodexAdapter implements AgentAdapter {
  readonly name = 'codex';
  private readonly config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  async execute(prompt: string, workDir: string, env?: Record<string, string>): Promise<AgentResult> {
    const args = [
      '--quiet',
      '--prompt',
      prompt,
      '--cwd',
      workDir,
      ...(this.config.args ?? []),
    ];

    return spawnAgent('codex', args, {
      cwd: workDir,
      env,
    });
  }
}
