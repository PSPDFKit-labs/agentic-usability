import { writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentConfig, AgentResult } from '../core/types.js';
import { BaseAdapter } from './base.js';

export class CodexAdapter extends BaseAdapter {
  readonly name = 'codex';
  readonly installCommand = 'npm i -g @openai/codex';

  constructor(config: AgentConfig) {
    super(config);
  }

  sandboxCommand(prompt: string, workDir = '/workspace'): string {
    const escaped = this.escapeForShell(prompt);
    const args = this.config.args ?? [];
    return `codex -q --full-auto --dangerously-bypass-approvals-and-sandbox --prompt '${escaped}' --cwd ${workDir} ${args.join(' ')}`.trimEnd();
  }

  protected buildInteractiveArgs(prompt: string, workDir: string): string[] {
    return ['--prompt', prompt, '--cwd', workDir, ...(this.config.args ?? [])];
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
      '--quiet',
      '--prompt',
      prompt,
      '--output-schema',
      schemaPath,
      '-o',
      outputPath,
      '--cwd',
      workDir,
      ...(this.config.args ?? []),
    ];

    const result = await this.spawn(args, workDir, env);

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
