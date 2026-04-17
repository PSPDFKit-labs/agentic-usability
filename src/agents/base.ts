import type { AgentConfig, AgentResult } from '../types.js';
import type { AgentAdapter } from './adapter.js';
import { spawnAgent, spawnInteractive } from './spawn.js';

export abstract class BaseAdapter implements AgentAdapter {
  abstract readonly name: string;
  abstract readonly installCommand: string | null;
  protected readonly config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  /**
   * Template method: spawn with schema → parse envelope → retry on failure.
   * Subclasses implement spawnWithSchema() and parseEnvelope().
   */
  async run(
    prompt: string,
    schema: object,
    workDir: string,
    options?: { env?: Record<string, string>; retries?: number },
  ): Promise<AgentResult> {
    const maxRetries = options?.retries ?? 1;
    let currentPrompt = prompt;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const result = await this.spawnWithSchema(currentPrompt, schema, workDir, options?.env);
      const cleaned = this.parseEnvelope(result);
      if (cleaned !== null) return cleaned;

      if (attempt < maxRetries) {
        currentPrompt = buildRetryPrompt(prompt, result.stdout);
      } else {
        return result;
      }
    }

    // Unreachable — loop always returns
    throw new Error('Unreachable');
  }

  async interactive(prompt: string, workDir: string): Promise<{ exitCode: number; durationMs: number }> {
    const args = this.buildInteractiveArgs(prompt, workDir);
    return spawnInteractive(this.config.command, args, { cwd: workDir });
  }

  abstract sandboxCommand(prompt: string, workDir?: string): string;

  /** Subclass: spawn the agent with schema-specific args, return raw result. */
  protected abstract spawnWithSchema(
    prompt: string,
    schema: object,
    workDir: string,
    env?: Record<string, string>,
  ): Promise<AgentResult>;

  /**
   * Subclass: try to unwrap the agent's envelope format.
   * Return the cleaned AgentResult, or null if parsing failed (triggers retry).
   */
  protected abstract parseEnvelope(result: AgentResult): AgentResult | null;

  /** Subclass: build CLI args for interactive (inherited stdio) invocation. */
  protected abstract buildInteractiveArgs(prompt: string, workDir: string): string[];

  /** Shared helper: spawn the agent process with piped stdio. */
  protected spawn(args: string[], workDir: string, env?: Record<string, string>, timeout?: number, stdin?: string): Promise<AgentResult> {
    return spawnAgent(this.config.command, args, { cwd: workDir, env, timeout, stdin });
  }

  /** Escape single quotes for shell embedding. */
  protected escapeForShell(str: string): string {
    return str.replace(/'/g, "'\\''");
  }

}

function buildRetryPrompt(originalPrompt: string, badOutput: string): string {
  return `${originalPrompt}

IMPORTANT: Your previous response was not valid JSON. Please output ONLY a valid JSON object. No markdown code fences, no explanation text — just the raw JSON starting with { or [ as appropriate.`;
}
