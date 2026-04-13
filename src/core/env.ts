import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Load a .env file and merge into process.env.
 * Existing process.env values take precedence (shell overrides .env file).
 * Supports KEY=VALUE, quotes (single/double), comments (#), and blank lines.
 */
export async function loadDotenv(dir: string = process.cwd()): Promise<void> {
  const envPath = resolve(dir, '.env');
  let content: string;
  try {
    content = await readFile(envPath, 'utf-8');
  } catch {
    return; // no .env file — silently skip
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Shell env takes precedence over .env file
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}