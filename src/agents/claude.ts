import { AgentConfig, AgentResult } from '../core/types.js';
import { AgentAdapter } from './adapter.js';
import { spawnAgent } from './spawn.js';

export class ClaudeAdapter implements AgentAdapter {
  readonly name = 'claude';
  readonly supportsSchema = true;
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
    });
  }

  async executeWithSchema(prompt: string, schema: object, workDir: string, env?: Record<string, string>): Promise<AgentResult> {
    const args = [
      '--print',
      '-p',
      prompt,
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify(schema),
      '--workdir',
      workDir,
      ...(this.config.args ?? []),
    ];

    const result = await spawnAgent('claude', args, {
      cwd: workDir,
      env,
    });

    // Parse the JSON envelope and extract structured output
    try {
      const envelope = JSON.parse(result.stdout);
      if (envelope.structured_output !== undefined) {
        result.stdout = JSON.stringify(envelope.structured_output);
      } else if (envelope.result !== undefined) {
        result.stdout = envelope.result;
      }
    } catch {
      // If envelope parsing fails, leave stdout as-is for downstream fallback
    }

    return result;
  }
}
