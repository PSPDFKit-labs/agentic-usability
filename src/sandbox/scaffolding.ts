import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { SandboxClient } from './opensandbox.js';
import type { Config, TestCase } from '../core/types.js';

/**
 * Recursively reads all files from a local directory, returning relative paths and content.
 */
async function readDirRecursive(
  dirPath: string,
  basePath: string = dirPath,
): Promise<Array<{ path: string; data: string }>> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files: Array<{ path: string; data: string }> = [];

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await readDirRecursive(fullPath, basePath);
      files.push(...nested);
    } else if (entry.isFile()) {
      const relPath = relative(basePath, fullPath);
      const data = await readFile(fullPath, 'utf-8');
      files.push({ path: `/workspace/${relPath}`, data });
    }
  }

  return files;
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
  client: SandboxClient,
  config: Config,
  testCase: TestCase,
): Promise<string> {
  const logs: string[] = [];

  // Layer 2: Template directory
  if (config.workspace?.template) {
    const templatePath = config.workspace.template;
    logs.push(`[Layer 2] Uploading template from ${templatePath}`);

    try {
      await stat(templatePath);
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

    const result = await client.runCommand(testCase.setupInstructions);
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
