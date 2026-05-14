import { readFile, readdir, stat as fsStat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { basename, join, relative, resolve as resolvePath } from 'node:path';
import { tmpdir } from 'node:os';
import type { MicrosandboxClient } from './microsandbox.js';
import type { Config, TestCase, SourceConfig, ExecutorPlugin, ResolvedExecutorPlugin } from '../types.js';
import { resolveSources, resolveSource } from '../core/source-resolver.js';

/** Directories excluded from source uploads — these are large and not useful for evaluation. */
const EXCLUDED_DIRS = [
  // VCS
  '.git', '.svn', '.hg',
  // JavaScript / Node
  'node_modules', '.next', '.nuxt', '.output', '.cache', '.parcel-cache',
  // Python
  '__pycache__', '.venv', 'venv', '.tox', '.mypy_cache', '.pytest_cache', '.ruff_cache',
  // .NET / C#
  'bin', 'obj', 'packages', '.vs', 'TestResults',
  // Java / Kotlin
  '.gradle', '.m2', 'target',
  // C / C++
  'CMakeFiles',
  // Go
  'vendor',
  // Rust
  // ('target' already listed above)
  // General build outputs
  'dist', 'build', 'out', 'output', '.build',
  // IDE / editor
  '.idea', '.vscode',
];

/** File extensions excluded from source archives — large binaries not useful for code review. */
const EXCLUDED_EXTENSIONS = [
  '*.dll', '*.exe', '*.pdb', '*.nupkg', '*.snupkg',
  '*.so', '*.dylib', '*.a', '*.lib', '*.o', '*.obj',
  '*.jar', '*.war', '*.ear', '*.class',
  '*.wasm',
  '*.pyc', '*.pyo',
  '*.zip', '*.tar', '*.tar.gz', '*.tgz', '*.tar.bz2', '*.rar', '*.7z',
  '*.pdf', '*.doc', '*.docx', '*.xls', '*.xlsx', '*.ppt', '*.pptx',
  '*.png', '*.jpg', '*.jpeg', '*.gif', '*.bmp', '*.ico', '*.svg', '*.webp',
  '*.mp3', '*.mp4', '*.avi', '*.mov', '*.wav', '*.flac',
  '*.ttf', '*.otf', '*.woff', '*.woff2', '*.eot',
];

/** Process-scoped cache: source path → tarball path on disk. */
const sourceArchiveCache = new Map<string, string>();

/**
 * Recursively reads all files from a local directory, returning paths and content.
 * @param targetPrefix - sandbox path prefix (e.g. '/workspace/' or '/workspace/sources/foo/')
 */
async function readDirRecursive(
  dirPath: string,
  basePath: string = dirPath,
  targetPrefix: string = '/workspace/',
): Promise<Array<{ path: string; data: string }>> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files: Array<{ path: string; data: string }> = [];

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await readDirRecursive(fullPath, basePath, targetPrefix);
      files.push(...nested);
    } else if (entry.isFile()) {
      const relPath = relative(basePath, fullPath);
      try {
        const data = await readFile(fullPath, 'utf-8');
        files.push({ path: `${targetPrefix}${relPath}`, data });
      } catch {
        // Skip binary files that can't be read as UTF-8
      }
    }
  }

  return files;
}

/**
 * Create a tar.gz archive of a directory, excluding common bloat dirs.
 * Archives are cached on disk so concurrent sandboxes reuse the same tarball.
 */
export async function getSourceArchive(srcPath: string): Promise<string> {
  const cached = sourceArchiveCache.get(srcPath);
  if (cached) {
    try {
      await fsStat(cached);
      return cached;
    } catch {
      sourceArchiveCache.delete(srcPath);
    }
  }

  const dirName = basename(srcPath);
  const tarPath = join(tmpdir(), `agentic-sources-${dirName}-${Date.now()}.tar.gz`);

  const excludeArgs = [
    ...EXCLUDED_DIRS.flatMap((d) => ['--exclude', d]),
    ...EXCLUDED_EXTENSIONS.flatMap((ext) => ['--exclude', ext]),
  ];

  await new Promise<void>((resolve, reject) => {
    execFile('tar', ['czf', tarPath, ...excludeArgs, '-C', srcPath, '.'], {
      timeout: 300_000,
      maxBuffer: 50 * 1024 * 1024,
    }, (error) => {
      if (error) reject(new Error(`Failed to create source archive for ${srcPath}: ${error.message}`));
      else resolve();
    });
  });

  sourceArchiveCache.set(srcPath, tarPath);
  return tarPath;
}

/**
 * Tar a host directory, upload the archive to the sandbox, and extract it
 * into `sandboxDestDir`. Used for any "copy this directory tree to a known
 * path inside the VM" operation (source uploads, plugin installs).
 *
 * `archiveLabel` should be a slug-safe identifier (used only to name the
 * temporary tarball path inside the sandbox).
 */
export async function uploadDirToSandbox(
  client: MicrosandboxClient,
  hostDir: string,
  sandboxDestDir: string,
  archiveLabel: string,
): Promise<void> {
  const tarPath = await getSourceArchive(hostDir);
  const tarData = await readFile(tarPath);
  const sandboxTarPath = `/tmp/_${archiveLabel}.tar.gz`;
  await client.uploadBinaryFile(sandboxTarPath, tarData);
  const result = await client.runCommand(
    `mkdir -p '${sandboxDestDir}' && tar xzf '${sandboxTarPath}' -C '${sandboxDestDir}' && rm -f '${sandboxTarPath}'`,
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to extract '${hostDir}' into sandbox at '${sandboxDestDir}': ` +
      `${result.stderr || result.stdout}`,
    );
  }
}

/**
 * Scaffolds a sandbox workspace with up to 3 optional layers:
 * - Layer 2 (Template): uploads local template directory to /workspace/
 * - Layer 3 (Global Setup): uploads and executes config.workspace.setupScript
 * - Layer 4 (Per-Test Setup): executes testCase.setupInstructions
 *
 * Returns a log string that callers can save as setup.log.
 */
export async function scaffoldWorkspace(
  client: MicrosandboxClient,
  config: Config,
  testCase: TestCase,
): Promise<string> {
  const logs: string[] = [];

  // Layer 1: Ensure /workspace exists — all subsequent layers assume it.
  await client.runCommand('mkdir -p /workspace');

  // Layer 2: Template directory
  if (config.workspace?.template) {
    const templatePath = config.workspace.template;
    logs.push(`[Layer 2] Uploading template from ${templatePath}`);

    try {
      await fsStat(templatePath);
    } catch {
      throw new Error(
        `Template directory not found: ${templatePath}`,
      );
    }

    const files = await readDirRecursive(templatePath);
    if (files.length > 0) {
      await client.uploadFiles(files);
      logs.push(`[Layer 2] Uploaded ${files.length} file(s)`);
    } else {
      logs.push(`[Layer 2] Template directory is empty, nothing to upload`);
    }
  }

  // Layer 3: Global setup script
  if (config.workspace?.setupScript) {
    const scriptPath = config.workspace.setupScript;
    logs.push(`[Layer 3] Running global setup script: ${scriptPath}`);

    const scriptContent = await readFile(scriptPath, 'utf-8');
    await client.uploadFiles([
      { path: '/workspace/.setup.sh', data: scriptContent },
    ]);

    const result = await client.runCommand('chmod +x /workspace/.setup.sh && /workspace/.setup.sh');
    if (result.stdout) logs.push(`[Layer 3] stdout: ${result.stdout}`);
    if (result.stderr) logs.push(`[Layer 3] stderr: ${result.stderr}`);

    if (result.exitCode !== 0) {
      throw new Error(
        `Global setup script failed with exit code ${result.exitCode}:\n${result.stderr || result.stdout}`,
      );
    }

    logs.push(`[Layer 3] Setup script completed successfully`);
  }

  // Layer 4: Per-test setup instructions
  if (testCase.setupInstructions) {
    logs.push(`[Layer 4] Running per-test setup instructions`);

    const result = await client.runCommand(`cd /workspace && ${testCase.setupInstructions}`);
    if (result.stdout) logs.push(`[Layer 4] stdout: ${result.stdout}`);
    if (result.stderr) logs.push(`[Layer 4] stderr: ${result.stderr}`);

    if (result.exitCode !== 0) {
      logs.push(
        `[Layer 4] Warning: per-test setup exited with code ${result.exitCode}`,
      );
    }

    logs.push(`[Layer 4] Per-test setup completed`);
  }

  return logs.join('\n');
}

/**
 * Resolves project sources (local + git) and uploads them into the sandbox
 * at /workspace/sources/<dirname>/.
 * Returns the list of sandbox source directory paths for prompt construction.
 *
 * Directory sources are tarred on the host and uploaded as archives to avoid
 * reading thousands of files into Node.js memory (which causes OOM on large repos).
 * Archives are cached on disk so concurrent sandboxes share one tarball.
 */
export async function uploadSources(
  client: MicrosandboxClient,
  sources: SourceConfig[],
  cacheRepos: string,
): Promise<string[]> {
  const sourcePaths = await resolveSources(sources, { reposDir: cacheRepos });
  if (sourcePaths.length === 0) return [];

  const sandboxDirs: string[] = [];

  for (const srcPath of sourcePaths) {
    const srcStat = await fsStat(srcPath);

    if (srcStat.isFile()) {
      // Single file source — upload directly into /workspace/sources/
      const fileName = basename(srcPath);
      const targetPath = `/workspace/sources/${fileName}`;
      sandboxDirs.push(targetPath);
      try {
        const data = await readFile(srcPath, 'utf-8');
        await client.uploadFiles([{ path: targetPath, data }]);
      } catch {
        // Skip binary files that can't be read as UTF-8
      }
    } else {
      // Directory source — tar on host, upload tarball, extract in sandbox.
      // This avoids loading thousands of files into JS heap.
      const dirName = basename(srcPath);
      const targetPrefix = `/workspace/sources/${dirName}/`;
      sandboxDirs.push(targetPrefix);

      await uploadDirToSandbox(client, srcPath, targetPrefix, `sources_${dirName}`);
    }
  }

  return sandboxDirs;
}

/**
 * Resolve `config.executorPlugins` to host-side directories. Reuses the
 * existing source-resolver for git clones (cached under `cacheRepos`) so
 * repeat runs don't re-clone the same plugin source.
 *
 * Returns an empty array when no plugins are configured.
 */
export async function resolveExecutorPlugins(
  plugins: ExecutorPlugin[] | undefined,
  cacheRepos: string,
): Promise<ResolvedExecutorPlugin[]> {
  if (!plugins || plugins.length === 0) return [];

  const resolved: ResolvedExecutorPlugin[] = [];
  for (const plugin of plugins) {
    if (plugin.type === 'local') {
      // Reuse resolveSource for consistent path semantics (resolves relative paths against cwd).
      const hostDir = await resolveSource(
        { type: 'local', path: plugin.path },
        { reposDir: cacheRepos },
      );
      resolved.push({ name: plugin.name, hostDir: resolvePath(hostDir) });
    } else {
      const hostDir = await resolveSource(
        {
          type: 'git',
          url: plugin.url,
          branch: plugin.branch,
          subpath: plugin.subpath,
          sparse: plugin.sparse,
        },
        { reposDir: cacheRepos },
      );
      resolved.push({ name: plugin.name, hostDir: resolvePath(hostDir) });
    }
  }
  return resolved;
}
