import { access, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import type { SourceConfig, LocalSource, GitSource } from '../types.js';

export interface ResolveOptions {
  fresh?: boolean;
  reposDir?: string;
}

/**
 * Resolve a single local or git source to a local filesystem path.
 * URL and package sources are not resolved to filesystem paths.
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
      throw new Error('URL sources are not resolved to filesystem paths.');
    case 'package':
      throw new Error('Package sources are not resolved to filesystem paths.');
  }
}

/**
 * Resolve all local and git sources from a SourceConfig array to filesystem paths.
 * URL and package sources are skipped.
 */
export async function resolveSources(
  sources: SourceConfig[],
  options: ResolveOptions = {}
): Promise<string[]> {
  const paths: string[] = [];
  for (const source of sources) {
    if (source.type === 'url' || source.type === 'package') continue;
    paths.push(await resolveSource(source, options));
  }
  return paths;
}

/** Combine multiple source arrays, deduplicating by identity (type + path/url/name). */
export function deduplicateSources(...arrays: SourceConfig[][]): SourceConfig[] {
  const seen = new Set<string>();
  const result: SourceConfig[] = [];
  for (const sources of arrays) {
    for (const s of sources) {
      const key = sourceKey(s);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(s);
      }
    }
  }
  return result;
}

function sourceKey(s: SourceConfig): string {
  switch (s.type) {
    case 'local': return `local:${s.path}:${s.subpath ?? ''}`;
    case 'git': return `git:${s.url}:${s.branch ?? ''}:${s.subpath ?? ''}`;
    case 'url': return `url:${s.url}`;
    case 'package': return `package:${s.name}`;
  }
}

async function resolveLocal(source: LocalSource): Promise<string> {
  const basePath = resolve(source.path);
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
  source: GitSource,
  options: ResolveOptions
): Promise<string> {
  const reposDir = options.reposDir ?? 'cache/repos';
  const url = source.url;
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
