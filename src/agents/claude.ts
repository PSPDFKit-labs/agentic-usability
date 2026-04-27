import type { AgentConfig, AgentResult } from '../types.js';
import type { MicrosandboxClient } from '../sandbox/microsandbox.js';
import { BaseAdapter } from './base.js';

export class ClaudeAdapter extends BaseAdapter {
  readonly name = 'claude';
  readonly installCommand = 'npm i -g @anthropic-ai/claude-code';
  readonly baseUrlEnvVar = 'ANTHROPIC_BASE_URL';
  readonly defaultEnvVar = 'ANTHROPIC_API_KEY';
  readonly defaultBaseUrl = 'https://api.anthropic.com';

  constructor(config: AgentConfig) {
    super(config);
  }

  sandboxCommand(prompt: string, workDir = '/workspace', schema?: object): string {
    const escaped = this.escapeForShell(prompt);
    const args = this.config.args ?? [];
    const schemaFlags = schema
      ? ` --output-format json --json-schema '${this.escapeForShell(JSON.stringify(schema))}'`
      : '';
    const cmd = `cd ${workDir} && IS_SANDBOX=1 claude --print --dangerously-skip-permissions ${args.join(' ')} '${escaped}'${schemaFlags}`.trimEnd();
    return cmd;
  }

  protected buildInteractiveArgs(prompt: string, _workDir: string): string[] {
    return [prompt, ...(this.config.args ?? [])];
  }

  protected async spawnWithSchema(
    prompt: string,
    schema: object,
    workDir: string,
    env?: Record<string, string>,
  ): Promise<AgentResult> {
    const args = [
      '--print',
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify(schema),
      ...(this.config.args ?? []),
    ];

    return this.spawn(args, workDir, env, undefined, prompt);
  }

  async extractLog(client: MicrosandboxClient): Promise<string | null> {
    const result = await client.runCommand(
      "find / -path '*/.claude/projects/*/*.jsonl' -type f 2>/dev/null | sort | tail -1",
    );
    const logPath = result.stdout.trim();
    if (!logPath || result.exitCode !== 0) return null;
    try {
      return await client.readFile(logPath);
    } catch {
      return null;
    }
  }

  protected parseEnvelope(result: AgentResult): AgentResult | null {
    try {
      const envelope = JSON.parse(result.stdout);
      if (envelope.structured_output !== undefined) {
        return { ...result, stdout: JSON.stringify(envelope.structured_output) };
      }
      if (envelope.result !== undefined) {
        return { ...result, stdout: envelope.result };
      }
      // Valid JSON but no known envelope field — return as-is
      return result;
    } catch {
      return null;
    }
  }
}
