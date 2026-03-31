import { AgentConfig, AgentResult } from '../core/types.js';
import { AgentAdapter } from './adapter.js';
import { spawnAgent } from './spawn.js';

export class GeminiAdapter implements AgentAdapter {
  readonly name = 'gemini';
  private readonly config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  async execute(prompt: string, workDir: string, env?: Record<string, string>): Promise<AgentResult> {
    const args = [
      '--prompt',
      prompt,
      '--cwd',
      workDir,
      ...(this.config.args ?? []),
    ];

    return spawnAgent('gemini', args, {
      cwd: workDir,
      env,
    });
  }
}
