import {
  Sandbox,
  ConnectionConfig,
  type SandboxCreateOptions,
} from '@alibaba-group/opensandbox';
import type { SandboxConfig } from '../types.js';

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Returns the hostname that sandboxes can use to reach the host machine.
 * On macOS (Docker Desktop) this is `host.docker.internal`.
 * On Linux it's the Docker bridge gateway, defaulting to `172.17.0.1`.
 * Can be overridden via the `SANDBOX_HOST_ADDRESS` env var.
 */
export function getSandboxHostAddress(): string {
  if (process.env.SANDBOX_HOST_ADDRESS) {
    return process.env.SANDBOX_HOST_ADDRESS;
  }
  return process.platform === 'darwin'
    ? 'host.docker.internal'
    : '172.17.0.1';
}

export class SandboxClient {
  private sandbox: Sandbox | null = null;
  private readonly connectionConfig: ConnectionConfig;

  constructor(config: SandboxConfig) {
    this.connectionConfig = new ConnectionConfig({
      domain: config.domain,
      apiKey: config.apiKey,
    });
  }

  async create(
    image: string,
    env?: Record<string, string>,
    timeout?: number,
  ): Promise<void> {
    const opts: SandboxCreateOptions = {
      connectionConfig: this.connectionConfig,
      image,
      env,
      timeoutSeconds: timeout ?? 600,
      readyTimeoutSeconds: 60,
    };

    try {
      this.sandbox = await Sandbox.create(opts);
    } catch (err) {
      throw new Error(
        `Failed to create sandbox with image '${image}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async uploadFiles(
    files: Array<{ path: string; data: string }>,
  ): Promise<void> {
    const sbx = this.requireSandbox();
    try {
      await sbx.files.writeFiles(
        files.map((f) => ({ path: f.path, data: f.data })),
      );
    } catch (err) {
      throw new Error(
        `Failed to upload files: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async runCommand(cmd: string, opts?: { envs?: Record<string, string> }): Promise<CommandResult> {
    const sbx = this.requireSandbox();
    try {
      const execution = await sbx.commands.run(cmd, opts?.envs ? { envs: opts.envs } : undefined);
      const stdout = execution.logs.stdout.map((m) => m.text).join('');
      const stderr = execution.logs.stderr.map((m) => m.text).join('');
      const exitCode = execution.exitCode ?? 1;
      return { stdout, stderr, exitCode };
    } catch (err) {
      throw new Error(
        `Failed to run command '${cmd}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async runCommandTimed(cmd: string, opts?: { envs?: Record<string, string> }): Promise<CommandResult & { durationMs: number }> {
    const start = Date.now();
    const result = await this.runCommand(cmd, opts);
    return { ...result, durationMs: Date.now() - start };
  }

  async listFiles(path: string): Promise<string[]> {
    const sbx = this.requireSandbox();
    try {
      const results = await sbx.files.search({ path });
      return results.map((f) => f.path);
    } catch (err) {
      throw new Error(
        `Failed to list files at '${path}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async readFile(path: string): Promise<string> {
    const sbx = this.requireSandbox();
    try {
      return await sbx.files.readFile(path);
    } catch (err) {
      throw new Error(
        `Failed to read file '${path}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async readBinaryFile(path: string): Promise<Buffer> {
    const result = await this.runCommand(`base64 '${path.replace(/'/g, "'\\''")}'`);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to read binary file '${path}': ${result.stderr}`);
    }
    return Buffer.from(result.stdout.replace(/\s/g, ''), 'base64');
  }

  async uploadBinaryFile(sandboxPath: string, data: Buffer): Promise<void> {
    const b64 = data.toString('base64');
    const tmpPath = '/tmp/_upload_b64.txt';
    // Upload base64 text via the normal file API, then decode to target path
    await this.uploadFiles([{ path: tmpPath, data: b64 }]);
    const escaped = sandboxPath.replace(/'/g, "'\\''");
    const result = await this.runCommand(
      `mkdir -p "$(dirname '${escaped}')" && base64 -d '${tmpPath}' > '${escaped}' && rm -f '${tmpPath}'`,
    );
    if (result.exitCode !== 0) {
      throw new Error(`Failed to upload binary file '${sandboxPath}': ${result.stderr}`);
    }
  }

  async destroy(): Promise<void> {
    if (!this.sandbox) return;
    try {
      await this.sandbox.kill();
    } catch {
      // Best-effort kill — sandbox may already be gone
    }
    try {
      await this.sandbox.close();
    } catch {
      // Best-effort close
    }
    this.sandbox = null;
  }

  static async checkConnectivity(config: SandboxConfig): Promise<void> {
    const conn = new ConnectionConfig({
      domain: config.domain,
      apiKey: config.apiKey,
    });
    const isLocal = config.domain.startsWith('localhost') || config.domain.startsWith('127.');
    const protocol = isLocal ? 'http' : 'https';
    try {
      const healthUrl = `${protocol}://${config.domain}/health`;
      const response = await fetch(healthUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok && response.status !== 401) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `OpenSandbox server unreachable at '${config.domain}'. ` +
          `Ensure the server is running:\n` +
          `  1. Install: pip install opensandbox-server (or: uv tool install opensandbox-server)\n` +
          `  2. Init config: opensandbox-server init-config ~/.sandbox.toml --example docker\n` +
          `  3. Run: opensandbox-server\n` +
          `  4. Verify: curl ${protocol}://${config.domain}/health\n` +
          `Error: ${message}`,
      );
    } finally {
      await conn.closeTransport();
    }
  }

  private requireSandbox(): Sandbox {
    if (!this.sandbox) {
      throw new Error(
        'No sandbox is active. Call create() before using sandbox operations.',
      );
    }
    return this.sandbox;
  }
}
