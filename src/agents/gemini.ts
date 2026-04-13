import { AgentConfig, AgentResult } from '../core/types.js';
import { AgentAdapter } from './adapter.js';
import { spawnAgent } from './spawn.js';

export class GeminiAdapter implements AgentAdapter {
  readonly name = 'gemini';
  readonly supportsSchema = false;
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

  async executeWithSchema(prompt: string, _schema: object, workDir: string, env?: Record<string, string>): Promise<AgentResult> {
    const args = [
      '--prompt',
      prompt,
      '--output-format',
      'json',
      '--cwd',
      workDir,
      ...(this.config.args ?? []),
    ];

    const result = await spawnAgent('gemini', args, {
      cwd: workDir,
      env,
    });

    // Parse Gemini's JSON envelope to extract the response content
    try {
      const envelope = JSON.parse(result.stdout);
      if (typeof envelope.response === 'string') {
        result.stdout = envelope.response;
      }
    } catch {
      // If envelope parsing fails, leave stdout as-is
    }

    return result;
  }
}
