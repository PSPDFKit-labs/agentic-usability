import { readFile, writeFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunInfo } from '../types.js';

const RUN_MANIFEST = 'run.json';

/** Generate a filesystem-safe run ID from the current timestamp. */
export function generateRunId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `run-${ts}`;
}

/** Read a run manifest from a directory. Returns null if missing or invalid. */
export async function loadRunInfo(runDir: string): Promise<RunInfo | null> {
  try {
    const raw = await readFile(join(runDir, RUN_MANIFEST), 'utf-8');
    return JSON.parse(raw) as RunInfo;
  } catch {
    return null;
  }
}

/** Write a run manifest to a directory. */
export async function saveRunInfo(runDir: string, info: RunInfo): Promise<void> {
  await writeFile(join(runDir, RUN_MANIFEST), JSON.stringify(info, null, 2) + '\n', 'utf-8');
}

/** List all runs inside the results directory, sorted newest-first. */
export async function listRuns(resultsDir: string): Promise<RunInfo[]> {
  let entries: string[];
  try {
    entries = await readdir(resultsDir);
  } catch {
    return [];
  }

  const runs: RunInfo[] = [];
  for (const name of entries) {
    const dir = join(resultsDir, name);
    const s = await stat(dir).catch(() => null);
    if (!s?.isDirectory()) continue;
    const info = await loadRunInfo(dir);
    if (info) runs.push(info);
  }

  // Sort newest first by createdAt
  runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return runs;
}

/** Return the most recent run ID, or null if no runs exist. */
export async function getLatestRunId(resultsDir: string): Promise<string | null> {
  const runs = await listRuns(resultsDir);
  return runs.length > 0 ? runs[0].id : null;
}

/** Reject path segments containing traversal characters. */
function safeName(s: string): string | null {
  if (!s || s.includes('..') || s.includes('/') || s.includes('\\') || s.includes('\0')) return null;
  return s;
}

/** Delete a run and all its artifacts. */
export async function deleteRun(resultsDir: string, runId: string): Promise<void> {
  const safe = safeName(runId);
  if (!safe) throw new Error(`Invalid run ID: ${runId}`);
  const dir = join(resultsDir, safe);

  // Verify it's actually a run (has run.json)
  const info = await loadRunInfo(dir);
  if (!info) throw new Error(`Run not found: ${runId}`);

  await rm(dir, { recursive: true, force: true });
}
