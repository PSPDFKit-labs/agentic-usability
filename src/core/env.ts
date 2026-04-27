import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Load a .env file and merge into process.env.
 * Existing process.env values take precedence (shell overrides .env file).
 * Supports KEY=VALUE, quotes (single/double), comments (#), blank lines,
 * and 1Password references (op://vault/item/field) resolved via `op read`.
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
    if (process.env[key] !== undefined) continue;

    // Resolve 1Password references via `op read`
    if (value.startsWith('op://')) {
      value = resolveOpReference(key, value);
    }

    process.env[key] = value;
  }
}

/**
 * Resolve a 1Password secret reference (op://vault/item/field) using the `op` CLI.
 */
function resolveOpReference(key: string, reference: string): string {
  try {
    return execFileSync('op', ['read', reference], {
      encoding: 'utf-8',
      timeout: 10_000,
    }).trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to resolve 1Password reference for ${key} (${reference}): ${msg}\n` +
      `Ensure the 'op' CLI is installed and you are signed in (op signin).`
    );
  }
}
