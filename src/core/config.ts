import { readFile } from 'node:fs/promises';
import { Config } from './types.js';

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

  // Validate source
  if (!obj.source || typeof obj.source !== 'object' || Array.isArray(obj.source)) {
    throw new Error('Config missing required field: source');
  }

  const source = obj.source as Record<string, unknown>;

  if (!source.type || typeof source.type !== 'string') {
    throw new Error('Config missing required field: source.type');
  }

  if (!['local', 'git', 'url'].includes(source.type)) {
    throw new Error(
      `Invalid source.type: '${source.type}'. Must be one of: 'local', 'git', 'url'`
    );
  }

  if (source.type === 'local') {
    if (!source.path || typeof source.path !== 'string') {
      throw new Error("source.type 'local' requires source.path to be set");
    }
  } else if (source.type === 'git') {
    if (!source.url || typeof source.url !== 'string') {
      throw new Error("source.type 'git' requires source.url to be set");
    }
  } else if (source.type === 'url') {
    if (!Array.isArray(source.urls) || source.urls.length === 0) {
      throw new Error("source.type 'url' requires source.urls array with at least one URL");
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
