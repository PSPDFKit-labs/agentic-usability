import chalk from 'chalk';
import open from 'open';
import { createServer } from '../server/index.js';
import type { ProjectPaths } from '../types.js';

export async function inspectCommand(paths: ProjectPaths, options: { port?: number } = {}): Promise<void> {
  const port = options.port ?? 7373;
  const server = createServer(paths);

  await new Promise<void>((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => {
      console.log(chalk.bold('\nAgentic Usability — Inspect UI\n'));
      console.log(`  ${chalk.cyan('URL:')}       http://localhost:${port}`);
      console.log(`  ${chalk.cyan('Pipeline:')}  ${paths.root}`);
      console.log(chalk.dim('\n  Press Ctrl+C to stop.\n'));
      open(`http://localhost:${port}`).catch(() => {});
      resolve();
    });
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use. Try --port <number> to use a different port.`));
      } else {
        reject(err);
      }
    });
  });

  // Keep the process alive until Ctrl+C
  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => {
      console.log(chalk.dim('\nShutting down...'));
      server.close(() => resolve());
    });
  });
}
