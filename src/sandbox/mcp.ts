import type { ResolvedExecutorMcpServer } from '../types.js';
import type { MicrosandboxClient } from './microsandbox.js';
import { uploadDirToSandbox } from './scaffolding.js';

export const MCP_ROOT_PLACEHOLDER = '${MCP_ROOT}';

export function substituteMcpRoot(args: string[], destDir: string): string[] {
  return args.map((a) => a.split(MCP_ROOT_PLACEHOLDER).join(destDir));
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
 *
 * `{ includeAll: true }` on the upload is load-bearing — an MCP server is a
 * runnable artifact and needs its `node_modules`, which the default
 * source-archive exclusion strips.
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
    await uploadDirToSandbox(client, server.hostDir, destDir, `mcp_${server.name}`, { includeAll: true });
    return {
      name: server.name,
      command: server.command,
      args: substituteMcpRoot(server.args, destDir),
    };
  }));
}
