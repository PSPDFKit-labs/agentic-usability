import { readFile } from 'node:fs/promises';
import { Config, AgentConfig } from '../types.js';
import { createAdapter } from '../agents/adapter.js';

export async function loadConfig(configPath: string): Promise<Config> {
  let raw: string;
  try {
    raw = await readFile(configPath, 'utf-8');
  } catch {
    throw new Error(
      `Config file not found: ${configPath}\nRun 'agentic-usability init' to create one.`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${configPath}`);
  }

  return validateConfig(parsed, configPath);
}

const VALID_SOURCE_TYPES = ['local', 'git', 'url', 'package'];

function validateSourceEntry(source: Record<string, unknown>, prefix: string): void {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error(`${prefix} must be an object`);
  }

  if (!source.type || typeof source.type !== 'string') {
    throw new Error(`${prefix} missing required field: type`);
  }

  if (!VALID_SOURCE_TYPES.includes(source.type)) {
    throw new Error(
      `${prefix}.type '${source.type}' is invalid. Must be one of: ${VALID_SOURCE_TYPES.map(t => `'${t}'`).join(', ')}`
    );
  }

  switch (source.type) {
    case 'local':
      if (!source.path || typeof source.path !== 'string') {
        throw new Error(`${prefix} type 'local' requires path to be set`);
      }
      break;
    case 'git':
      if (!source.url || typeof source.url !== 'string') {
        throw new Error(`${prefix} type 'git' requires url to be set`);
      }
      break;
    case 'url':
      if (!source.url || typeof source.url !== 'string') {
        throw new Error(`${prefix} type 'url' requires url to be set`);
      }
      break;
    case 'package':
      if (!source.name || typeof source.name !== 'string') {
        throw new Error(`${prefix} type 'package' requires name to be set`);
      }
      break;
  }
}

export function validateConfig(data: unknown, configPath?: string): Config {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`Config must be a JSON object in ${configPath}`);
  }

  const obj = data as Record<string, unknown>;

  // Validate privateInfo
  if (!Array.isArray(obj.privateInfo) || obj.privateInfo.length === 0) {
    throw new Error('Config requires a non-empty privateInfo array');
  }

  for (let i = 0; i < obj.privateInfo.length; i++) {
    validateSourceEntry(obj.privateInfo[i] as Record<string, unknown>, `privateInfo[${i}]`);
  }

  // Validate publicInfo (optional)
  if (obj.publicInfo !== undefined) {
    if (!Array.isArray(obj.publicInfo)) {
      throw new Error('Config publicInfo must be an array of source entries');
    }
    for (let i = 0; i < obj.publicInfo.length; i++) {
      validateSourceEntry(obj.publicInfo[i] as Record<string, unknown>, `publicInfo[${i}]`);
    }
  }

  // Validate targets
  if (!Array.isArray(obj.targets) || obj.targets.length === 0) {
    throw new Error('Config requires at least one target in targets array');
  }

  // Validate sandbox
  if (!obj.sandbox || typeof obj.sandbox !== 'object' || Array.isArray(obj.sandbox)) {
    throw new Error('Config missing required field: sandbox');
  }

  const sandbox = obj.sandbox as Record<string, unknown>;

  // Validate secrets entries if present
  if (sandbox.secrets && typeof sandbox.secrets === 'object' && !Array.isArray(sandbox.secrets)) {
    for (const [key, entry] of Object.entries(sandbox.secrets as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`sandbox.secrets.${key} must be an object with { value, allowHosts }`);
      }
      const secretEntry = entry as Record<string, unknown>;
      if (!secretEntry.value || typeof secretEntry.value !== 'string') {
        throw new Error(`sandbox.secrets.${key} missing required field: value`);
      }
      if (!Array.isArray(secretEntry.allowHosts) || secretEntry.allowHosts.length === 0) {
        throw new Error(`sandbox.secrets.${key} requires a non-empty allowHosts array`);
      }
    }
  }

  // Validate agent configs and secrets
  const SANDBOX_ROLES = ['executor', 'judge'];

  if (obj.agents && typeof obj.agents === 'object' && !Array.isArray(obj.agents)) {
    const agents = obj.agents as Record<string, unknown>;
    for (const [role, agentCfg] of Object.entries(agents)) {
      if (!agentCfg || typeof agentCfg !== 'object' || Array.isArray(agentCfg)) continue;
      const agent = agentCfg as Record<string, unknown>;
      const command = agent.command as string | undefined;
      const isSandboxRole = SANDBOX_ROLES.includes(role);

      if (isSandboxRole) {
        const useOAuth = agent.useOAuth === true;

        if (useOAuth) {
          // OAuth path: Claude Code subscription via CLAUDE_CODE_OAUTH_TOKEN.
          if (command !== 'claude') {
            throw new Error(
              `agents.${role}.useOAuth: true is only supported for command: "claude" (Claude Code subscription auth). ` +
              `Got command: "${command ?? '(unset)'}".`,
            );
          }
          if (agent.secret !== undefined) {
            throw new Error(
              `agents.${role} cannot set both useOAuth and secret — choose one auth path.`,
            );
          }
        } else {
          // API-key path: secret with TLS-injected value.
          if (!agent.secret || typeof agent.secret !== 'object' || Array.isArray(agent.secret)) {
            throw new Error(
              `agents.${role} requires either { secret: {...} } or { useOAuth: true } for sandbox auth`,
            );
          }
          const secret = agent.secret as Record<string, unknown>;
          if (!secret.value || typeof secret.value !== 'string') {
            throw new Error(`agents.${role}.secret.value must be a non-empty string`);
          }

          // Fill defaults from adapter for known agents
          const adapter = createAdapter({ command } as AgentConfig);
          if (adapter.defaultEnvVar) {
            if (!secret.envVar) secret.envVar = adapter.defaultEnvVar;
            if (!secret.baseUrl) secret.baseUrl = adapter.defaultBaseUrl;
            if (!secret.baseUrlEnvVar) secret.baseUrlEnvVar = adapter.baseUrlEnvVar;
          } else {
            // Custom agents must specify envVar and baseUrl
            if (!secret.envVar || typeof secret.envVar !== 'string') {
              throw new Error(`agents.${role}.secret.envVar is required for custom agent '${command}'`);
            }
            if (!secret.baseUrl || typeof secret.baseUrl !== 'string') {
              throw new Error(`agents.${role}.secret.baseUrl is required for custom agent '${command}'`);
            }
          }

          // Validate baseUrl is a valid URL
          try {
            new URL(secret.baseUrl as string);
          } catch {
            throw new Error(`agents.${role}.secret.baseUrl must be a valid URL`);
          }
        }
      }
    }
  }

  return obj as unknown as Config;
}
