import { writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentConfig, AgentResult } from '../core/types.js';
import { AgentAdapter } from './adapter.js';
import { spawnAgent } from './spawn.js';

export class CodexAdapter implements AgentAdapter {
  readonly name = 'codex';
  readonly supportsSchema = true;
  private readonly config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  async execute(prompt: string, workDir: string, env?: Record<string, string>): Promise<AgentResult> {
    const args = [
      '--quiet',
      '--prompt',
      prompt,
      '--cwd',
      workDir,
      ...(this.config.args ?? []),
    ];

    return spawnAgent('codex', args, {
      cwd: workDir,
      env,
    });
  }

  async executeWithSchema(prompt: string, schema: object, workDir: string, env?: Record<string, string>): Promise<AgentResult> {
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

    const result = await spawnAgent('codex', args, {
      cwd: workDir,
      env,
    });

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
}
