import { AgentConfig, AgentResult } from '../core/types.js';
import { AgentAdapter } from './adapter.js';
import { spawnAgent } from './spawn.js';

export class CustomAdapter implements AgentAdapter {
  readonly name: string;
  readonly supportsSchema = false;
  private readonly config: AgentConfig;

  constructor(config: AgentConfig) {
    this.name = `custom:${config.command}`;
    this.config = config;
  }

  async execute(prompt: string, workDir: string, env?: Record<string, string>): Promise<AgentResult> {
    const args = (this.config.args ?? []).map((arg) =>
      arg.replace(/\{prompt\}/g, prompt).replace(/\{workDir\}/g, workDir)
    );

    return spawnAgent(this.config.command, args, {
      cwd: workDir,
      env,
    });
  }

  async executeWithSchema(prompt: string, _schema: object, workDir: string, env?: Record<string, string>): Promise<AgentResult> {
    // Custom agents don't support schema constraints — schema is already in the prompt text
    return this.execute(prompt, workDir, env);
  }
}
