import chalk from 'chalk';
import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { loadConfig } from '../core/config.js';
import { validateTestSuite, printSuiteTable } from './suite-utils.js';
import type { ProjectPaths } from '../core/paths.js';

export async function editCommand(paths: ProjectPaths): Promise<void> {
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

  const editor = process.env.EDITOR ?? 'vi';
  console.log(chalk.cyan(`Opening ${suiteFile} in ${editor}...`));

  // Get mtime before editing
  const beforeStat = await stat(suiteFile);

  await new Promise<void>((resolveP, reject) => {
    const child = spawn(editor, [suiteFile], { stdio: 'inherit' });
    child.on('close', (code) => {
      if (code === 0) {
        resolveP();
      } else {
        reject(new Error(`Editor exited with code ${code}`));
      }
    });
    child.on('error', (err) => {
      reject(new Error(`Failed to open editor '${editor}': ${err.message}`));
    });
  });

  // Check if file was modified
  const afterStat = await stat(suiteFile);
  if (afterStat.mtimeMs === beforeStat.mtimeMs) {
    console.log(chalk.yellow('No changes detected.'));
    return;
  }

  // Re-validate the suite
  const raw = await readFile(suiteFile, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Suite file is not valid JSON after editing: ${msg}`);
  }

  const testCases = validateTestSuite(parsed);
  console.log(chalk.green('Suite validated successfully.'));
  printSuiteTable(testCases);
}
