import chalk from 'chalk';
import ora from 'ora';
import { basename, resolve } from 'node:path';
import { createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import archiver from 'archiver';
import type { ProjectPaths } from '../types.js';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function exportCommand(
  paths: ProjectPaths,
  options: { output?: string; run?: string },
): Promise<void> {
  const pipelineName = basename(paths.root);
  const outputPath = resolve(options.output ?? `${pipelineName}-export.zip`);

  const spinner = ora('Creating zip archive...').start();

  const output = createWriteStream(outputPath);
  const archive = archiver('zip', { zlib: { level: 6 } });

  const done = new Promise<void>((res, rej) => {
    output.on('close', res);
    archive.on('error', rej);
  });

  archive.pipe(output);

  const sourceDir = options.run
    ? resolve(paths.results, options.run)
    : paths.root;

  const prefix = options.run ? options.run : pipelineName;

  // Verify the source directory exists
  try {
    await stat(sourceDir);
  } catch {
    spinner.fail(`Directory not found: ${sourceDir}`);
    process.exitCode = 1;
    return;
  }

  archive.glob('**/*', {
    cwd: sourceDir,
    ignore: [
      'cache/**',
      '**/*.tar.gz',
      '**/node_modules/**',
    ],
    dot: false,
  }, { prefix });

  await archive.finalize();
  await done;

  const { size } = await stat(outputPath);
  spinner.succeed(`Exported ${chalk.bold(outputPath)} (${formatBytes(size)})`);
}
