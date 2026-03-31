import { AgentConfig, AgentResult } from '../core/types.js';
import { AgentAdapter } from './adapter.js';
import { spawnAgent } from './spawn.js';

export class ClaudeAdapter implements AgentAdapter {
  readonly name = 'claude';
  private readonly config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  async execute(prompt: string, workDir: string, env?: Record<string, string>): Promise<AgentResult> {
    const args = [
      '--print',
      '-p',
      prompt,
      '--workdir',
      workDir,
      ...(this.config.args ?? []),
    ];

    return spawnAgent('claude', args, {
      cwd: workDir,
      env,
      timeout: this.config.args?.includes('--timeout')
        ? undefined
        : undefined,
    });
  }
}
