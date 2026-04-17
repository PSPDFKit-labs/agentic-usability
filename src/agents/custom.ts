import type { AgentConfig, AgentResult } from '../types.js';
import { BaseAdapter } from './base.js';

export class CustomAdapter extends BaseAdapter {
  readonly name: string;

  get installCommand(): string | null {
    return this.config.installCommand ?? null;
  }

  constructor(config: AgentConfig) {
    super(config);
    this.name = `custom:${config.command}`;
  }

  sandboxCommand(prompt: string, workDir = '/workspace', _schema?: object): string {
    const escaped = this.escapeForShell(prompt);
    const baseArgs = this.resolveArgs(this.config.args ?? [], `'${escaped}'`, workDir);
    const sandboxArgs = this.config.sandboxArgs ?? [];
    const allArgs = [...baseArgs, ...sandboxArgs];
    const cmd = `${this.config.command} ${allArgs.join(' ')}`.trimEnd();
    return cmd;
  }

  protected buildInteractiveArgs(prompt: string, workDir: string): string[] {
    const source = this.config.interactiveArgs ?? this.config.args ?? [];
    return this.resolveArgs(source, prompt, workDir);
  }

  protected async spawnWithSchema(
    prompt: string,
    _schema: object,
    workDir: string,
    env?: Record<string, string>,
  ): Promise<AgentResult> {
    const source = this.config.pipedArgs ?? this.config.args ?? [];
    const args = this.resolveArgs(source, prompt, workDir);
    return this.spawn(args, workDir, env, this.config.timeout);
  }

  protected parseEnvelope(result: AgentResult): AgentResult | null {
    const envelopeField = this.config.envelope;

    // "none" means raw stdout is the output — no parsing needed
    if (envelopeField === 'none') {
      return result;
    }

    try {
      const parsed = JSON.parse(result.stdout);

      // If an envelope field is configured, extract it
      if (envelopeField && parsed[envelopeField] !== undefined) {
        const extracted = parsed[envelopeField];
        return {
          ...result,
          stdout: typeof extracted === 'string' ? extracted : JSON.stringify(extracted),
        };
      }

      // No envelope field configured — if it's valid JSON, return as-is
      return result;
    } catch {
      return null;
    }
  }

  /** Replace {prompt} and {workDir} placeholders in an args array. */
  private resolveArgs(args: string[], prompt: string, workDir: string): string[] {
    return args.map((arg) =>
      arg.replace(/\{prompt\}/g, prompt).replace(/\{workDir\}/g, workDir)
    );
  }
}
