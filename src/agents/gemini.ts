import type { AgentConfig, AgentResult } from '../types.js';
import { BaseAdapter } from './base.js';

export class GeminiAdapter extends BaseAdapter {
  readonly name = 'gemini';
  readonly installCommand = 'npm i -g @google/gemini-cli';

  constructor(config: AgentConfig) {
    super(config);
  }

  sandboxCommand(prompt: string, workDir = '/workspace', schema?: object): string {
    const escaped = this.escapeForShell(prompt);
    const args = this.config.args ?? [];
    const jsonFlag = schema ? ' -o json' : '';
    const cmd = `cd ${workDir} && GEMINI_SANDBOX=false gemini --yolo -p '${escaped}' ${args.join(' ')}${jsonFlag}`.trimEnd();
    return cmd;
  }

  protected buildInteractiveArgs(prompt: string, _workDir: string): string[] {
    return ['-i', prompt, ...(this.config.args ?? [])];
  }

  protected async spawnWithSchema(
    prompt: string,
    _schema: object,
    workDir: string,
    env?: Record<string, string>,
  ): Promise<AgentResult> {
    const args = [
      '-o',
      'json',
      ...(this.config.args ?? []),
    ];

    return this.spawn(args, workDir, env, undefined, prompt);
  }

  protected parseEnvelope(result: AgentResult): AgentResult | null {
    try {
      const envelope = JSON.parse(result.stdout);
      if (typeof envelope.response === 'string') {
        return { ...result, stdout: envelope.response };
      }
      // Valid JSON but no known envelope — return as-is
      return result;
    } catch {
      return null;
    }
  }
}
