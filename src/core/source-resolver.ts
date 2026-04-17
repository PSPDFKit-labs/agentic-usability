import { access, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import type { Config, SourceConfig } from '../types.js';

export interface ResolveOptions {
  fresh?: boolean;
  reposDir?: string;
}

/**
 * Resolve a single local or git SourceConfig to a local filesystem path.
 * URL sources are not resolved — use getUrlSources() instead.
 */
export async function resolveSource(
  source: SourceConfig,
  options: ResolveOptions = {}
): Promise<string> {
  switch (source.type) {
    case 'local':
      return resolveLocal(source);
    case 'git':
      return resolveGit(source, options);
    case 'url':
      throw new Error('URL sources are not resolved to filesystem paths. Use getUrlSources() to get URLs for prompt inclusion.');
  }
}

/**
 * Resolve all local and git sources in a Config to filesystem paths.
 * URL sources are skipped — use getUrlSources() for those.
 */
export async function resolveSources(
  config: Config,
  options: ResolveOptions = {}
): Promise<string[]> {
  const paths: string[] = [];
  for (const source of config.sources) {
    if (source.type === 'url') continue;
    paths.push(await resolveSource(source, options));
  }
  return paths;
}

/**
 * Extract URL sources from a Config as plain URL strings.
 * These are passed directly to agents as links to browse.
 */
export function getUrlSources(config: Config): { url: string; additionalContext?: string }[] {
  return config.sources
    .filter((s): s is SourceConfig & { url: string } => s.type === 'url' && !!s.url)
    .map((s) => ({ url: s.url, additionalContext: s.additionalContext }));
}

async function resolveLocal(source: SourceConfig): Promise<string> {
  const basePath = resolve(source.path!);
  const fullPath = source.subpath
    ? join(basePath, source.subpath)
    : basePath;

  try {
    await access(fullPath);
  } catch {
    throw new Error(`Directory not found: ${fullPath}`);
  }

  return fullPath;
}

async function resolveGit(
  source: SourceConfig,
  options: ResolveOptions
): Promise<string> {
  const reposDir = options.reposDir ?? 'cache/repos';
  const url = source.url!;
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 12);
  const cloneDir = resolve(reposDir, hash);

  const exists = await dirExists(cloneDir);

  if (exists && !options.fresh) {
    return appendSubpath(cloneDir, source.subpath);
  }

  if (exists && options.fresh) {
    await rmDir(cloneDir);
  }

  await mkdir(cloneDir, { recursive: true });

  if (source.sparse && source.sparse.length > 0) {
    await cloneSparse(url, cloneDir, source.branch, source.sparse);
  } else {
    await cloneShallow(url, cloneDir, source.branch);
  }

  return appendSubpath(cloneDir, source.subpath);
}

async function cloneShallow(
  url: string,
  dest: string,
  branch?: string
): Promise<void> {
  const args = ['clone', '--depth', '1'];
  if (branch) {
    args.push('--branch', branch);
  }
  args.push(url, dest);

  await gitExec(args);
}

async function cloneSparse(
  url: string,
  dest: string,
  branch?: string,
  sparse?: string[]
): Promise<void> {
  // Initialize a bare repo, configure sparse checkout, then fetch
  await gitExec(['init', dest]);
  await gitExec(['-C', dest, 'remote', 'add', 'origin', url]);
  await gitExec(['-C', dest, 'config', 'core.sparseCheckout', 'true']);

  // Write sparse checkout paths
  const sparseFile = join(dest, '.git', 'info', 'sparse-checkout');
  await writeFile(sparseFile, sparse!.join('\n') + '\n', 'utf-8');

  const fetchBranch = branch ?? 'HEAD';
  await gitExec(['-C', dest, 'fetch', '--depth', '1', 'origin', fetchBranch]);

  const checkoutRef = branch ? `origin/${branch}` : 'FETCH_HEAD';
  await gitExec(['-C', dest, 'checkout', checkoutRef]);
}

function gitExec(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { timeout: 120_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Git clone failed: ${stderr.trim() || error.message}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function appendSubpath(dir: string, subpath?: string): string {
  return subpath ? join(dir, subpath) : dir;
}

async function dirExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function rmDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}
