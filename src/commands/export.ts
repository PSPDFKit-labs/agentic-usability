import chalk from 'chalk';
import { copyFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig } from '../core/config.js';
import type { ProjectPaths } from '../core/paths.js';

export async function exportCommand(paths: ProjectPaths, options: { output: string }): Promise<void> {
  await loadConfig(paths.config); // validate config exists
  const suiteFile = paths.suite;

  // Verify suite file exists
  try {
    await stat(suiteFile);
  } catch {
    throw new Error(
      `Suite file not found: ${suiteFile}\nRun 'agentic-usability generate' first.`
    );
  }

  const outputPath = resolve(options.output);
  await copyFile(suiteFile, outputPath);
  console.log(chalk.green(`Suite exported to ${outputPath}`));
}
