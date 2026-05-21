import { readFile, stat as fsStat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ResolvedExecutorMcpServer } from '../types.js';
import type { MicrosandboxClient } from './microsandbox.js';

export const MCP_ROOT_PLACEHOLDER = '${MCP_ROOT}';

export function substituteMcpRoot(args: string[], destDir: string): string[] {
  return args.map((a) => a.split(MCP_ROOT_PLACEHOLDER).join(destDir));
}

/**
 * Process-scoped cache: MCP server source path → verbatim-tarball path on disk.
 * Kept separate from the SDK-source archive cache in `scaffolding.ts` because
 * MCP server payloads are runnable artifacts (must include `node_modules` and
 * any build output), while SDK-source archives strip those for code review.
 */
const mcpServerArchiveCache = new Map<string, string>();

/** Create a verbatim tar.gz archive of an MCP server source directory. */
async function tarMcpServerSource(srcPath: string): Promise<string> {
  const cached = mcpServerArchiveCache.get(srcPath);
  if (cached) {
    try {
      await fsStat(cached);
      return cached;
    } catch {
      mcpServerArchiveCache.delete(srcPath);
    }
  }

  const dirName = basename(srcPath);
  const tarPath = join(tmpdir(), `agentic-mcp-server-${dirName}-${Date.now()}.tar.gz`);

  await new Promise<void>((resolve, reject) => {
    execFile('tar', ['czf', tarPath, '-C', srcPath, '.'], {
      timeout: 300_000,
      maxBuffer: 50 * 1024 * 1024,
    }, (error) => {
      if (error) reject(new Error(`Failed to archive MCP server source at ${srcPath}: ${error.message}`));
      else resolve();
    });
  });

  mcpServerArchiveCache.set(srcPath, tarPath);
  return tarPath;
}

/**
 * Tar an MCP server source directory on the host, upload it to the sandbox,
 * and extract it into `sandboxDestDir`. Separate from `uploadDirToSandbox`
 * because MCP servers are runnable artifacts: the archive must include
 * `node_modules` (and any other "bloat" the SDK-source path strips) or the
 * server crashes on spawn with ERR_MODULE_NOT_FOUND.
 */
export async function uploadMcpServerPayload(
  client: MicrosandboxClient,
  hostDir: string,
  sandboxDestDir: string,
  serverName: string,
): Promise<void> {
  const tarPath = await tarMcpServerSource(hostDir);
  const tarData = await readFile(tarPath);
  const sandboxTarPath = `/tmp/_mcp_${serverName}.tar.gz`;
  await client.uploadBinaryFile(sandboxTarPath, tarData);
  const result = await client.runCommand(
    `mkdir -p '${sandboxDestDir}' && tar xzf '${sandboxTarPath}' -C '${sandboxDestDir}' && rm -f '${sandboxTarPath}'`,
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to extract MCP server '${serverName}' into sandbox at '${sandboxDestDir}': ` +
      `${result.stderr || result.stdout}`,
    );
  }
}

export interface ResolvedMcpServerArgs {
  name: string;
  command: string;
  args: string[];
}

/**
 * Upload sourced MCP server payloads in parallel and return per-server resolved
 * args (with `${MCP_ROOT}` substituted for the sandbox install dir). Sourceless
 * entries pass through with their original args. Each adapter then writes its
 * CLI-specific MCP config from the result.
 */
export async function uploadMcpServerSources(
  client: MicrosandboxClient,
  mcpRoot: string,
  servers: ResolvedExecutorMcpServer[],
): Promise<ResolvedMcpServerArgs[]> {
  return Promise.all(servers.map(async (server) => {
    if (server.kind === 'sourceless') {
      return { name: server.name, command: server.command, args: server.args };
    }
    const destDir = `${mcpRoot}/${server.name}`;
    await uploadMcpServerPayload(client, server.hostDir, destDir, server.name);
    return {
      name: server.name,
      command: server.command,
      args: substituteMcpRoot(server.args, destDir),
    };
  }));
}
