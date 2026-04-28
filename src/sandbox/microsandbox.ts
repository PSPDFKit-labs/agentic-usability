import { Sandbox, Secret } from 'microsandbox';
import type {
  SandboxConfig as MsbSandboxConfig,
  SecretEntry,
  FsEntry,
} from 'microsandbox';
import type { SandboxConfig, SecretConfig, AgentSecretConfig } from '../types.js';

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Build microsandbox `Secret.env()` entries from the config's `secrets` map.
 * Values starting with `$` are resolved from host `process.env`.
 */
export function buildSecrets(
  secrets: Record<string, SecretConfig> | undefined,
): SecretEntry[] {
  if (!secrets) return [];
  const entries: SecretEntry[] = [];
  for (const [envVar, cfg] of Object.entries(secrets)) {
    const value = resolveValue(cfg.value, envVar);
    entries.push(
      Secret.env(envVar, {
        value,
        allowHosts: cfg.allowHosts,
        allowHostPatterns: cfg.allowHostPatterns,
      }),
    );
  }
  return entries;
}

/**
 * Resolve plain env vars from the config's `env` map.
 * Values starting with `$` are resolved from host `process.env`.
 */
export function resolveEnv(
  env: Record<string, string> | undefined,
): Record<string, string> {
  if (!env) return {};
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    resolved[key] = resolveValue(value, key);
  }
  return resolved;
}

/**
 * Build a microsandbox `Secret.env()` entry from an agent's secret config.
 * The `allowHosts` is derived from the base URL hostname.
 */
export function buildAgentSecret(secret: AgentSecretConfig): SecretEntry {
  if (!secret.envVar || !secret.baseUrl) {
    throw new Error('Agent secret must have envVar and baseUrl set (should be filled by config validation)');
  }
  const value = resolveValue(secret.value, secret.envVar);
  const hostname = new URL(secret.baseUrl).hostname;
  return Secret.env(secret.envVar, { value, allowHosts: [hostname] });
}

function resolveValue(value: string, envVar: string): string {
  if (value.startsWith('$')) {
    const hostVar = value.slice(1);
    const hostValue = process.env[hostVar];
    if (hostValue === undefined) {
      throw new Error(
        `Environment variable '${hostVar}' referenced in sandbox config for ${envVar} is not set on the host`,
      );
    }
    return hostValue;
  }
  return value;
}

export class MicrosandboxClient {
  private sandbox: Sandbox | null = null;
  private readonly config: SandboxConfig;

  constructor(config: SandboxConfig) {
    this.config = config;
  }

  /**
   * Create and boot a new microsandbox VM.
   */
  async create(
    name: string,
    image: string,
    env?: Record<string, string>,
    secrets?: SecretEntry[],
    timeout?: number,
  ): Promise<void> {
    const maxDurationSecs = timeout ?? this.config.defaultTimeout ?? 600;

    const sbConfig: MsbSandboxConfig = {
      name,
      image,
      memoryMib: this.config.memoryMib ?? 2048,
      cpus: this.config.cpus ?? 2,
      env: env && Object.keys(env).length > 0 ? env : undefined,
      secrets: secrets && secrets.length > 0 ? secrets : undefined,
      maxDurationSecs: maxDurationSecs + 120, // hard safety net — extraction window is the gap
      replace: true,
      network: {
        egressInterceptHosts: ['*'],
        egressTimeoutMs: 0, // Prevent connection issues for long-running Agent connection
      },
      logLevel: 'debug'
    };

    try {
      this.sandbox = await Sandbox.create(sbConfig);
    } catch (err) {
      throw new Error(
        `Failed to create sandbox '${name}' with image '${image}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Get the underlying Sandbox instance (for egress interception). */
  getSandbox(): Sandbox {
    return this.requireSandbox();
  }

  async uploadFiles(
    files: Array<{ path: string; data: string | Uint8Array }>,
  ): Promise<void> {
    const sbx = this.requireSandbox();
    const fs = sbx.fs();
    for (const f of files) {
      try {
        const data = typeof f.data === 'string' ? Buffer.from(f.data, 'utf8') : Buffer.from(f.data);
        await fs.write(f.path, data);
      } catch (err) {
        throw new Error(
          `Failed to upload file '${f.path}': ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  async runCommand(cmd: string, opts?: { timeoutMs?: number }): Promise<CommandResult> {
    const sbx = this.requireSandbox();
    try {
      const output = opts?.timeoutMs
        ? await sbx.execWithConfig({ cmd: '/bin/sh', args: ['-c', cmd], timeoutMs: opts.timeoutMs })
        : await sbx.shell(cmd);
      return {
        stdout: output.stdout(),
        stderr: output.stderr(),
        exitCode: output.code,
      };
    } catch (err) {
      throw new Error(
        `Failed to run command '${cmd}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async runCommandTimed(cmd: string, opts?: { timeoutMs?: number }): Promise<CommandResult & { durationMs: number }> {
    const start = Date.now();
    const result = await this.runCommand(cmd, opts);
    return { ...result, durationMs: Date.now() - start };
  }

  async listFiles(path: string): Promise<string[]> {
    const sbx = this.requireSandbox();
    try {
      const entries: FsEntry[] = await sbx.fs().list(path);
      return entries.map((e) => e.path);
    } catch (err) {
      throw new Error(
        `Failed to list files at '${path}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async readFile(path: string): Promise<string> {
    const sbx = this.requireSandbox();
    try {
      return await sbx.fs().readString(path);
    } catch (err) {
      throw new Error(
        `Failed to read file '${path}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async readBinaryFile(path: string): Promise<Buffer> {
    const sbx = this.requireSandbox();
    try {
      return await sbx.fs().read(path);
    } catch (err) {
      throw new Error(
        `Failed to read binary file '${path}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async uploadBinaryFile(sandboxPath: string, data: Buffer): Promise<void> {
    const sbx = this.requireSandbox();
    try {
      await sbx.fs().write(sandboxPath, data);
    } catch (err) {
      throw new Error(
        `Failed to upload binary file '${sandboxPath}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async fileExists(path: string): Promise<boolean> {
    const sbx = this.requireSandbox();
    try {
      return await sbx.fs().exists(path);
    } catch {
      return false;
    }
  }

  /**
   * Kill sandbox and clean up. Used after extraction completes and by abort handlers.
   */
  async destroy(): Promise<void> {
    if (!this.sandbox) return;
    try {
      await this.sandbox.kill();
    } catch {
      // Best-effort kill
    }
    try {
      await this.sandbox.removePersisted();
    } catch {
      // Best-effort cleanup
    }
    this.sandbox = null;
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
