import chalk from 'chalk';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { loadConfig, ensureWorkingDir } from '../core/config.js';
import { validateTestSuite, printSuiteTable } from './suite-utils.js';

const DEFAULT_SUITE_FILE = '.agentic-usability/suite.json';

export async function importCommand(options: { input: string }): Promise<void> {
  const config = await loadConfig();
  await ensureWorkingDir();

  const inputPath = resolve(options.input);
  const suiteFile = resolve(config.output?.suiteFile ?? DEFAULT_SUITE_FILE);

  // Read and parse input file
  let raw: string;
  try {
    raw = await readFile(inputPath, 'utf-8');
  } catch {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Input file is not valid JSON: ${msg}`);
  }

  const testCases = validateTestSuite(parsed);

  // Check if suite already exists and prompt for confirmation
  let exists = false;
  try {
    await stat(suiteFile);
    exists = true;
  } catch {
    // File doesn't exist, no confirmation needed
  }

  if (exists) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      chalk.yellow(`Suite file already exists at ${suiteFile}. Overwrite? (y/N) `)
    );
    rl.close();

    if (answer.toLowerCase() !== 'y') {
      console.log(chalk.yellow('Import cancelled.'));
      return;
    }
  }

  await writeFile(suiteFile, JSON.stringify(testCases, null, 2), 'utf-8');
  console.log(chalk.green(`Suite imported to ${suiteFile}`));
  printSuiteTable(testCases);
}
