import { access, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import TurndownService from 'turndown';
import { Config } from './types.js';

const REPOS_DIR = '.agentic-usability/repos';

export interface ResolveOptions {
  fresh?: boolean;
}

export async function resolveSource(
  config: Config,
  options: ResolveOptions = {}
): Promise<string> {
  switch (config.source.type) {
    case 'local':
      return resolveLocal(config);
    case 'git':
      return resolveGit(config, options);
    case 'url':
      return resolveUrl(config, options);
  }
}

async function resolveLocal(config: Config): Promise<string> {
  const basePath = resolve(config.source.path!);
  const fullPath = config.source.subpath
    ? join(basePath, config.source.subpath)
    : basePath;

  try {
    await access(fullPath);
  } catch {
    throw new Error(`Directory not found: ${fullPath}`);
  }

  return fullPath;
}

async function resolveGit(
  config: Config,
  options: ResolveOptions
): Promise<string> {
  const url = config.source.url!;
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 12);
  const cloneDir = resolve(REPOS_DIR, hash);

  const exists = await dirExists(cloneDir);

  if (exists && !options.fresh) {
    return appendSubpath(cloneDir, config.source.subpath);
  }

  if (exists && options.fresh) {
    await rmDir(cloneDir);
  }

  await mkdir(cloneDir, { recursive: true });

  if (config.source.sparse && config.source.sparse.length > 0) {
    await cloneSparse(url, cloneDir, config.source.branch, config.source.sparse);
  } else {
    await cloneShallow(url, cloneDir, config.source.branch);
  }

  return appendSubpath(cloneDir, config.source.subpath);
}

async function resolveUrl(
  config: Config,
  options: ResolveOptions
): Promise<string> {
  const urls = config.source.urls;
  if (!urls || urls.length === 0) {
    throw new Error("Source type 'url' requires a non-empty 'urls' array.");
  }

  const hash = createHash('sha256')
    .update(urls.join('\n'))
    .digest('hex')
    .slice(0, 12);
  const destDir = resolve(REPOS_DIR, `url-${hash}`);

  const exists = await dirExists(destDir);

  if (exists && !options.fresh) {
    return destDir;
  }

  if (exists && options.fresh) {
    await rmDir(destDir);
  }

  await mkdir(destDir, { recursive: true });

  const turndown = new TurndownService();

  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`Warning: Failed to fetch ${url} (HTTP ${response.status})`);
        continue;
      }

      const contentType = response.headers.get('content-type') ?? '';
      const body = await response.text();
      const filename = urlToFilename(url);

      if (contentType.includes('text/html')) {
        const markdown = turndown.turndown(body);
        await writeFile(join(destDir, filename + '.md'), markdown, 'utf-8');
      } else {
        const ext = contentType.includes('text/markdown') ? '.md' : '.txt';
        await writeFile(join(destDir, filename + ext), body, 'utf-8');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`Warning: Could not fetch ${url}: ${message}`);
    }
  }

  return destDir;
}

function urlToFilename(url: string): string {
  // Use URL path to derive a readable filename, falling back to hash
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.replace(/\/$/, '').split('/').filter(Boolean);
    if (segments.length > 0) {
      return segments.join('_').replace(/[^a-zA-Z0-9_.-]/g, '_');
    }
  } catch {
    // fall through to hash
  }
  return createHash('sha256').update(url).digest('hex').slice(0, 12);
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
