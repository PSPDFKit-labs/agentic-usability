import { resolve, join } from 'node:path';
import { mkdir } from 'node:fs/promises';

export interface ProjectPaths {
  /** Absolute path to the project root directory. */
  root: string;
  /** Absolute path to the config file. */
  config: string;
  /** Absolute path to the suite JSON file. */
  suite: string;
  /** Absolute path to the results directory. */
  results: string;
  /** Absolute path to the reports directory. */
  reports: string;
  /** Absolute path to the logs directory. */
  logs: string;
  /** Absolute path to the cache root directory. */
  cache: string;
  /** Absolute path to the git repos cache directory. */
  cacheRepos: string;

  /** Absolute path to the pipeline state file. */
  pipelineState: string;
}

/**
 * Resolve all project paths.
 *
 * - With `projectDir`: use that directory as the project root.
 * - Without: assume CWD is the project directory.
 *
 * Both resolve to the same layout: config.json, suite.json, results/, reports/, logs/, cache/.
 */
export function resolveProjectPaths(projectDir?: string): ProjectPaths {
  const root = resolve(projectDir ?? '.');
  return {
    root,
    config: join(root, 'config.json'),
    suite: join(root, 'suite.json'),
    results: join(root, 'results'),
    reports: join(root, 'reports'),
    logs: join(root, 'logs'),
    cache: join(root, 'cache'),
    cacheRepos: join(root, 'cache', 'repos'),

    pipelineState: join(root, 'logs', 'pipeline-state.json'),
  };
}

/**
 * Create all project directories (idempotent).
 */
export async function ensureProjectDirs(paths: ProjectPaths): Promise<void> {
  await Promise.all([
    mkdir(paths.root, { recursive: true }),
    mkdir(paths.results, { recursive: true }),
    mkdir(paths.reports, { recursive: true }),
    mkdir(paths.logs, { recursive: true }),
    mkdir(paths.cache, { recursive: true }),
    mkdir(paths.cacheRepos, { recursive: true }),
  ]);
}
