import {
  Sandbox,
  ConnectionConfig,
  type SandboxCreateOptions,
  SandboxException,
} from '@alibaba-group/opensandbox';
import type { SandboxConfig } from '../core/types.js';

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
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

  async runCommand(cmd: string): Promise<CommandResult> {
    const sbx = this.requireSandbox();
    try {
      const execution = await sbx.commands.run(cmd);
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
    try {
      const baseUrl = conn.getBaseUrl();
      const response = await fetch(`${baseUrl}/sandboxes`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok && response.status !== 401) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (err) {
      if (err instanceof SandboxException) {
        throw new Error(
          `OpenSandbox server unreachable at '${config.domain}'. ` +
            `Ensure the server is running:\n` +
            `  1. Install: docker pull ghcr.io/alibaba/opensandbox\n` +
            `  2. Run: docker run -d -p 8080:8080 ghcr.io/alibaba/opensandbox\n` +
            `  3. Verify: curl http://${config.domain}/v1/sandboxes\n` +
            `Error: ${err.message}`,
        );
      }
      throw new Error(
        `OpenSandbox server unreachable at '${config.domain}'. ` +
          `Ensure the server is running:\n` +
          `  1. Install: docker pull ghcr.io/alibaba/opensandbox\n` +
          `  2. Run: docker run -d -p 8080:8080 ghcr.io/alibaba/opensandbox\n` +
          `  3. Verify: curl http://${config.domain}/v1/sandboxes\n` +
          `Error: ${err instanceof Error ? err.message : String(err)}`,
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
