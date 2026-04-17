import { writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentConfig, AgentResult } from '../types.js';
import { BaseAdapter } from './base.js';

export class CodexAdapter extends BaseAdapter {
  readonly name = 'codex';
  readonly installCommand = 'npm i -g @openai/codex';

  constructor(config: AgentConfig) {
    super(config);
  }

  sandboxCommand(prompt: string, workDir = '/workspace', schema?: object): string {
    const escaped = this.escapeForShell(prompt);
    const args = this.config.args ?? [];
    const schemaPrefix = schema
      ? `printf '%s' '${this.escapeForShell(JSON.stringify(schema))}' > /tmp/_schema.json && `
      : '';
    const schemaFlags = schema ? ' --output-schema /tmp/_schema.json' : '';
    const cmd = `${schemaPrefix}codex exec --dangerously-bypass-approvals-and-sandbox -C ${workDir} '${escaped}' ${args.join(' ')}${schemaFlags}`.trimEnd();
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
    const timestamp = Date.now();
    const schemaPath = join(tmpdir(), `codex-schema-${timestamp}.json`);
    const outputPath = join(tmpdir(), `codex-output-${timestamp}.json`);

    await writeFile(schemaPath, JSON.stringify(schema), 'utf-8');

    const args = [
      'exec',
      '-C',
      workDir,
      '--full-auto',
      '--output-schema',
      schemaPath,
      '-o',
      outputPath,
      ...(this.config.args ?? []),
    ];

    const result = await this.spawn(args, workDir, env, undefined, prompt);

    // Read structured output from the output file
    try {
      result.stdout = await readFile(outputPath, 'utf-8');
    } catch {
      // If output file doesn't exist, use stdout as-is
    }

    // Clean up temp files
    await rm(schemaPath, { force: true }).catch(() => {});
    await rm(outputPath, { force: true }).catch(() => {});

    return result;
  }

  protected parseEnvelope(result: AgentResult): AgentResult | null {
    // Codex with schema writes structured output to a file (already read in spawnWithSchema).
    // Try to parse as JSON to validate it's well-formed.
    try {
      JSON.parse(result.stdout);
      return result;
    } catch {
      return null;
    }
  }
}
