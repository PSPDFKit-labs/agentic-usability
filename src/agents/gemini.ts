import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentConfig, AgentResult, ResolvedExecutorPlugin } from '../types.js';
import type { MicrosandboxClient } from '../sandbox/microsandbox.js';
import { uploadDirToSandbox } from '../sandbox/scaffolding.js';
import { BaseAdapter } from './base.js';

export class GeminiAdapter extends BaseAdapter {
  readonly name = 'gemini';
  readonly installCommand = 'npm i -g @google/gemini-cli';
  readonly baseUrlEnvVar = 'GEMINI_API_BASE_URL';
  readonly defaultEnvVar = 'GEMINI_API_KEY';
  readonly defaultBaseUrl = 'https://generativelanguage.googleapis.com';

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

  /**
   * Install plugin directories into the Gemini CLI's extensions folder.
   *
   * Gemini's extension model expects each extension dir to contain a
   * `gemini-extension.json` manifest at its root (see Gemini CLI docs:
   * Extensions reference). Auto-discovery loads extensions from
   * `${GEMINI_HOME:-$HOME/.gemini}/extensions/<name>/`.
   *
   * For each plugin we look for `gemini-extension.json` at the plugin root.
   * If present, the entire plugin directory is treated as a Gemini extension
   * and laid out at the expected location. If absent, we throw — the plugin
   * has nothing the Gemini CLI knows how to load, and an A/B comparison that
   * silently no-ops would be misleading.
   */
  async installPluginsInSandbox(
    client: MicrosandboxClient,
    plugins: ResolvedExecutorPlugin[],
  ): Promise<void> {
    if (plugins.length === 0) return;

    for (const plugin of plugins) {
      const manifestPath = join(plugin.hostDir, 'gemini-extension.json');
      try {
        await access(manifestPath);
      } catch {
        throw new Error(
          `Plugin '${plugin.name}' has no Gemini extension manifest at ${manifestPath}. ` +
          `Gemini CLI loads extensions from a 'gemini-extension.json' file at the extension root. ` +
          `Add one to the plugin directory or remove '${plugin.name}' from executorPlugins when running the Gemini executor.`,
        );
      }
    }

    const homeResult = await client.runCommand('printf %s "${HOME:-/root}"');
    const home = homeResult.stdout.trim() || '/root';
    const extensionsDir = `${home}/.gemini/extensions`;

    const setup = await client.runCommand(`mkdir -p '${extensionsDir}'`);
    if (setup.exitCode !== 0) {
      throw new Error(
        `Failed to prepare ${extensionsDir} in sandbox: ${setup.stderr || setup.stdout}`,
      );
    }

    for (const plugin of plugins) {
      const destDir = `${extensionsDir}/${plugin.name}`;
      await uploadDirToSandbox(client, plugin.hostDir, destDir, `gemini_ext_${plugin.name}`);
    }
  }

  async extractLog(client: MicrosandboxClient): Promise<string | null> {
    const result = await client.runCommand(
      "find / -path '*/.gemini/tmp/*/chats/session-*.jsonl' -type f 2>/dev/null | sort | tail -1",
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
