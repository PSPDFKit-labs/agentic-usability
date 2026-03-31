import chalk from 'chalk';
import { copyFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig } from '../core/config.js';

const DEFAULT_SUITE_FILE = '.agentic-usability/suite.json';

export async function exportCommand(options: { output: string }): Promise<void> {
  const config = await loadConfig();
  const suiteFile = resolve(config.output?.suiteFile ?? DEFAULT_SUITE_FILE);

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
