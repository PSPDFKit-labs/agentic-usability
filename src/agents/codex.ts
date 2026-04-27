import { writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentConfig, AgentResult } from '../types.js';
import type { MicrosandboxClient } from '../sandbox/microsandbox.js';
import { BaseAdapter } from './base.js';

export class CodexAdapter extends BaseAdapter {
  readonly name = 'codex';
  readonly installCommand = 'npm i -g @openai/codex';
  readonly baseUrlEnvVar = 'OPENAI_BASE_URL';
  readonly defaultEnvVar = 'OPENAI_API_KEY';
  readonly defaultBaseUrl = 'https://api.openai.com';

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

    // Codex currently only accepts root object schemas for --output-schema.
    // Wrap non-object schemas (e.g. the generator's top-level array) and unwrap
    // the result after reading the output file.
    const rootSchema = schema as { type?: string };
    const needsWrapper = rootSchema.type !== 'object';
    const codexSchema = needsWrapper
      ? {
          type: 'object',
          properties: {
            result: schema,
          },
          required: ['result'],
          additionalProperties: false,
        }
      : schema;

    await writeFile(schemaPath, JSON.stringify(codexSchema), 'utf-8');

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
      const raw = await readFile(outputPath, 'utf-8');
      if (needsWrapper) {
        const parsed = JSON.parse(raw) as { result?: unknown };
        result.stdout = JSON.stringify(parsed.result ?? null);
      } else {
        result.stdout = raw;
      }
    } catch {
      // If output file doesn't exist, use stdout as-is
    }

    // Clean up temp files
    await rm(schemaPath, { force: true }).catch(() => {});
    await rm(outputPath, { force: true }).catch(() => {});

    return result;
  }

  async extractLog(client: MicrosandboxClient): Promise<string | null> {
    const result = await client.runCommand(
      "find / -path '*/.codex/sessions/*.jsonl' -type f 2>/dev/null | sort | tail -1",
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
