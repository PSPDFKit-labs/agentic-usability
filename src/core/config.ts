import { readFile } from 'node:fs/promises';
import { Config } from '../types.js';

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

export function validateConfig(data: unknown, configPath?: string): Config {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`Config must be a JSON object in ${configPath}`);
  }

  const obj = data as Record<string, unknown>;

  // Validate sources
  if (!Array.isArray(obj.sources) || obj.sources.length === 0) {
    throw new Error('Config requires a non-empty sources array');
  }

  for (let i = 0; i < obj.sources.length; i++) {
    const source = obj.sources[i] as Record<string, unknown>;
    const prefix = `sources[${i}]`;

    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw new Error(`${prefix} must be an object`);
    }

    if (!source.type || typeof source.type !== 'string') {
      throw new Error(`${prefix} missing required field: type`);
    }

    if (!['local', 'git', 'url'].includes(source.type)) {
      throw new Error(
        `${prefix}.type '${source.type}' is invalid. Must be one of: 'local', 'git', 'url'`
      );
    }

    if (source.type === 'local') {
      if (!source.path || typeof source.path !== 'string') {
        throw new Error(`${prefix} type 'local' requires path to be set`);
      }
    } else if (source.type === 'git' || source.type === 'url') {
      if (!source.url || typeof source.url !== 'string') {
        throw new Error(`${prefix} type '${source.type}' requires url to be set`);
      }
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

  if (!sandbox.domain || typeof sandbox.domain !== 'string') {
    throw new Error('Config missing required field: sandbox.domain');
  }

  return obj as unknown as Config;
}
