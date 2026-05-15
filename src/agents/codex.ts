import { writeFile, readFile, rm, access, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentConfig, AgentResult, ResolvedExecutorPlugin } from '../types.js';
import type { MicrosandboxClient } from '../sandbox/microsandbox.js';
import { uploadDirToSandbox } from '../sandbox/scaffolding.js';
import { BaseAdapter } from './base.js';

export class CodexAdapter extends BaseAdapter {
  readonly name = 'codex';
  // Pin to 0.93.0: Current Codex (May 14th 2026) v0.130.0 have a lot of issues with WebSocket
  readonly installCommand = 'npm i -g @openai/codex@0.93.0';
  readonly baseUrlEnvVar = 'OPENAI_BASE_URL';
  readonly defaultEnvVar = 'CODEX_API_KEY';
  readonly defaultBaseUrl = 'https://api.openai.com/v1';
  readonly additionalAllowHosts = ['chatgpt.com', 'ab.chatgpt.com'];

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

  /**
   * Install plugin skills into the Codex CLI's auto-discovered skills dir.
   *
   * Codex doesn't have a "plugin" abstraction like Claude's marketplaces; it
   * auto-discovers individual skills under `${CODEX_HOME:-$HOME/.codex}/skills/<name>/`.
   * For each plugin we iterate its `skills/` subtree and lay out each
   * SKILL.md-bearing directory at `$CODEX_HOME/skills/<skill-name>/`.
   *
   * A plugin contributes nothing to Codex if it has no `.codex-plugin/plugin.json`
   * manifest, or if it has no `skills/` subdirectory with at least one
   * SKILL.md. We fail fast in that case so the user knows the A/B comparison
   * won't actually exercise the plugin.
   */
  async installPluginsInSandbox(
    client: MicrosandboxClient,
    plugins: ResolvedExecutorPlugin[],
  ): Promise<void> {
    if (plugins.length === 0) return;

    type SkillInstall = { plugin: string; srcDir: string; skillName: string };

    const perPluginSkills = await Promise.all(plugins.map(async (plugin): Promise<SkillInstall[]> => {
      const manifestPath = join(plugin.hostDir, '.codex-plugin', 'plugin.json');
      try {
        await access(manifestPath);
      } catch {
        throw new Error(
          `Plugin '${plugin.name}' is missing the Codex manifest at ${manifestPath}. ` +
          `Codex executors need each plugin to ship a .codex-plugin/plugin.json file.`,
        );
      }

      const skillsDir = join(plugin.hostDir, 'skills');
      let entries;
      try {
        entries = await readdir(skillsDir, { withFileTypes: true });
      } catch {
        throw new Error(
          `Plugin '${plugin.name}' has no 'skills/' directory at ${skillsDir}. ` +
          `Codex auto-discovers skills from individual subdirectories — bundle each as <plugin>/skills/<skill-name>/SKILL.md.`,
        );
      }

      const skillCandidates = await Promise.all(entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry): Promise<SkillInstall | null> => {
          const skillName = String(entry.name);
          const skillDir = join(skillsDir, skillName);
          try {
            const md = await stat(join(skillDir, 'SKILL.md'));
            if (!md.isFile()) return null;
          } catch {
            return null;
          }
          return { plugin: plugin.name, srcDir: skillDir, skillName };
        }),
      );
      const skills = skillCandidates.filter((s): s is SkillInstall => s !== null);

      if (skills.length === 0) {
        throw new Error(
          `Plugin '${plugin.name}' contains no usable Codex skills (no <skills>/<name>/SKILL.md). ` +
          `Each plugin must contribute at least one SKILL.md file under its skills/ subdirectory.`,
        );
      }
      return skills;
    }));

    // Target images run as root; matches the hardcoded path in ClaudeAdapter.
    const codexSkillsDir = '/root/.codex/skills';

    const seenSkillNames = new Set<string>();
    const installs: SkillInstall[] = [];
    for (const skill of perPluginSkills.flat()) {
      if (seenSkillNames.has(skill.skillName)) {
        throw new Error(
          `Skill '${skill.skillName}' is contributed by more than one plugin (latest: '${skill.plugin}'). ` +
          `Codex requires skill names to be unique across all installed plugins.`,
        );
      }
      seenSkillNames.add(skill.skillName);
      installs.push(skill);
    }

    await Promise.all(installs.map((skill) =>
      uploadDirToSandbox(
        client,
        skill.srcDir,
        `${codexSkillsDir}/${skill.skillName}`,
        `codex_skill_${skill.skillName}`,
      ),
    ));
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
