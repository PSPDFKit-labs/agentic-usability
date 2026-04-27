import { resolve, join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { ProjectPaths } from '../types.js';

/**
 * Resolve all project paths.
 *
 * - With `projectDir`: use that directory as the project root.
 * - Without: assume CWD is the project directory.
 *
 * Both resolve to the same layout: config.json, suite.json, results/, cache/.
 */
export function resolveProjectPaths(projectDir?: string): ProjectPaths {
  const root = resolve(projectDir ?? '.');
  return {
    root,
    config: join(root, 'config.json'),
    suite: join(root, 'suite.json'),
    results: join(root, 'results'),
    cache: join(root, 'cache'),
    cacheRepos: join(root, 'cache', 'repos'),

    pipelineState: join(root, 'results', 'pipeline-state.json'),
  };
}

/**
 * Return a copy of paths scoped to a specific run directory.
 * `results` → `<root>/results/<runId>`, `pipelineState` → inside the run dir.
 */
export function resolveRunPaths(paths: ProjectPaths, runId: string): ProjectPaths {
  const runResults = join(paths.results, runId);
  return {
    ...paths,
    results: runResults,
    pipelineState: join(runResults, 'pipeline-state.json'),
  };
}

/**
 * Create all project directories (idempotent).
 */
export async function ensureProjectDirs(paths: ProjectPaths): Promise<void> {
  await Promise.all([
    mkdir(paths.root, { recursive: true }),
    mkdir(paths.results, { recursive: true }),
    mkdir(paths.cache, { recursive: true }),
    mkdir(paths.cacheRepos, { recursive: true }),
  ]);
}
