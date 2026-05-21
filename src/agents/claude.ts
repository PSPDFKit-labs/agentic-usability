import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentConfig, AgentResult, ResolvedExecutorPlugin, ResolvedExecutorMcpServer } from '../types.js';
import type { MicrosandboxClient } from '../sandbox/microsandbox.js';
import { uploadDirToSandbox } from '../sandbox/scaffolding.js';
import { uploadMcpServerSources } from '../sandbox/mcp.js';
import { BaseAdapter } from './base.js';

export class ClaudeAdapter extends BaseAdapter {
  readonly name = 'claude';
  readonly installCommand = 'npm i -g @anthropic-ai/claude-code';
  readonly baseUrlEnvVar = 'ANTHROPIC_BASE_URL';
  readonly defaultEnvVar = 'ANTHROPIC_API_KEY';
  readonly defaultBaseUrl = 'https://api.anthropic.com';

  /**
   * Sandbox paths of plugins extracted by `installPluginsInSandbox()`.
   * `sandboxCommand()` reads this to emit `--plugin-dir <path>` flags so the
   * Claude CLI loads each plugin for the run. Populated only after install.
   */
  private installedPluginDirs: string[] = [];

  /**
   * Sandbox path of the MCP config JSON written by `installMcpServersInSandbox()`.
   * `sandboxCommand()` reads this to emit a `--mcp-config <path>` flag so the
   * Claude CLI connects to each MCP server for the run. Null until install.
   */
  private installedMcpConfigPath: string | null = null;

  constructor(config: AgentConfig) {
    super(config);
  }

  sandboxCommand(prompt: string, workDir = '/workspace', schema?: object): string {
    const escaped = this.escapeForShell(prompt);
    const args = this.config.args ?? [];
    const schemaFlags = schema
      ? ` --output-format json --json-schema '${this.escapeForShell(JSON.stringify(schema))}'`
      : '';
    // --plugin-dir is the documented Claude CLI flag for loading a local
    // plugin directory for the session. It's the simplest mechanism for our
    // executorPlugins use case — no marketplace registration, no trust
    // prompt, works cleanly in --print mode.
    const pluginFlags = this.installedPluginDirs
      .map((dir) => ` --plugin-dir '${dir}'`)
      .join('');
    // --mcp-config points the CLI at a JSON file of MCP servers to connect for
    // the session. We intentionally do NOT pass --strict-mcp-config so the
    // agent keeps any ambient MCP config alongside our injected servers.
    const mcpFlag = this.installedMcpConfigPath
      ? ` --mcp-config '${this.installedMcpConfigPath}'`
      : '';
    const cmd = `cd ${workDir} && IS_SANDBOX=1 claude --print --dangerously-skip-permissions${pluginFlags}${mcpFlag} ${args.join(' ')} '${escaped}'${schemaFlags}`.trimEnd();
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
    // Claude's --json-schema currently rejects top-level non-object schemas
    // (the API returns "400 tools.N.custom.input_schema.type: Input should be 'object'").
    // Wrap non-object schemas under a single `result` property and unwrap before
    // returning, so callers can hand us arrays / primitives transparently.
    // (Codex has the same wrap dance in its own adapter.)
    const rootSchema = schema as { type?: string };
    const needsWrapper = rootSchema.type !== 'object';
    const effectiveSchema = needsWrapper
      ? {
          type: 'object',
          properties: { result: schema },
          required: ['result'],
          additionalProperties: false,
        }
      : schema;

    const args = [
      '--print',
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify(effectiveSchema),
      ...(this.config.args ?? []),
    ];

    const result = await this.spawn(args, workDir, env, undefined, prompt);

    if (needsWrapper) {
      try {
        const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
        const so = envelope.structured_output as Record<string, unknown> | undefined;
        if (so && 'result' in so) {
          envelope.structured_output = so.result;
          result.stdout = JSON.stringify(envelope);
        }
      } catch {
        // Leave stdout untouched — parseEnvelope will handle it / trigger a retry.
      }
    }

    return result;
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

  /**
   * Install Claude Code plugins for the executor's CLI session.
   *
   * Each plugin is extracted under `$HOME/.claude/plugins/<name>/` and the
   * resulting paths are stashed for `sandboxCommand()` to emit as
   * `--plugin-dir <path>` flags. No marketplace registration or trust
   * prompt — those can't be answered in `--print` mode.
   */
  async installPluginsInSandbox(
    client: MicrosandboxClient,
    plugins: ResolvedExecutorPlugin[],
  ): Promise<void> {
    if (plugins.length === 0) return;

    await Promise.all(plugins.map(async (plugin) => {
      const manifestPath = join(plugin.hostDir, '.claude-plugin', 'plugin.json');
      try {
        await access(manifestPath);
      } catch {
        throw new Error(
          `Plugin '${plugin.name}' is missing the Claude manifest at ${manifestPath}. ` +
          `Each Claude Code plugin must contain a .claude-plugin/plugin.json file.`,
        );
      }
    }));

    const homeResult = await client.runCommand('printf %s "${HOME:-/root}"');
    const home = homeResult.stdout.trim() || '/root';
    const pluginsRoot = `${home}/.claude/plugins`;

    this.installedPluginDirs = await Promise.all(plugins.map(async (plugin) => {
      const destDir = `${pluginsRoot}/${plugin.name}`;
      await uploadDirToSandbox(client, plugin.hostDir, destDir, `plugin_${plugin.name}`);
      return destDir;
    }));
  }

  /**
   * Install MCP servers for the executor's Claude CLI session.
   *
   * Sourced servers are uploaded under `$HOME/.mcp-servers/<name>/` (outside
   * `/workspace` so the agent's workspace stays clean). `${MCP_ROOT}` in each
   * server's args is substituted with that server's sandbox install dir. A
   * combined MCP config JSON is written to `$HOME/.mcp-servers/mcp-config.json`
   * and surfaced to `sandboxCommand()` as a `--mcp-config` flag.
   */
  async installMcpServersInSandbox(
    client: MicrosandboxClient,
    servers: ResolvedExecutorMcpServer[],
  ): Promise<void> {
    if (servers.length === 0) return;

    const homeResult = await client.runCommand('printf %s "${HOME:-/root}"');
    // $HOME=/ slips past the ${HOME:-/root} shell fallback (it's set, just
    // degenerate). Collapse repeated slashes so e.g. $HOME=/// also normalises,
    // then treat a bare / as "no real home" and fall back to /root.
    const normalizedHome = homeResult.stdout.trim().replace(/\/+/g, '/');
    const home = !normalizedHome || normalizedHome === '/' ? '/root' : normalizedHome;
    const mcpRoot = `${home}/.mcp-servers`;

    const resolved = await uploadMcpServerSources(client, mcpRoot, servers);

    const mcpServers: Record<string, { command: string; args: string[] }> = {};
    for (const server of resolved) {
      mcpServers[server.name] = { command: server.command, args: server.args };
    }

    const configJson = JSON.stringify({ mcpServers }, null, 2);
    const configPath = `${mcpRoot}/mcp-config.json`;
    const encoded = Buffer.from(configJson, 'utf-8').toString('base64');
    const writeResult = await client.runCommand(
      `mkdir -p '${mcpRoot}' && printf %s '${encoded}' | base64 -d > '${configPath}'`,
    );
    if (writeResult.exitCode !== 0) {
      throw new Error(
        `Failed to write MCP config into sandbox at '${configPath}': ` +
        `${writeResult.stderr || writeResult.stdout}`,
      );
    }

    this.installedMcpConfigPath = configPath;
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
