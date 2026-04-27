import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import express from 'express';
import cors from 'cors';
import configRouter from './routes/config.js';
import suiteRouter from './routes/suite.js';
import resultsRouter from './routes/results.js';
import runsRouter from './routes/runs.js';
import type { ProjectPaths } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve the UI build directory (dist-ui/) at the project root.
// In dev/build layout: src/server/index.ts -> project root is ../../
// In compiled layout:  dist/server/index.js -> project root is ../../
const uiDir = resolve(__dirname, '..', '..', 'dist-ui');

export function createServer(paths: ProjectPaths): http.Server {
  const app = express();

  // Make paths available to all route handlers via app.locals
  app.locals['paths'] = paths;

  app.use(cors({ origin: /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/ }));
  app.use(express.json({ limit: '1mb' }));

  // API routes
  app.use('/api/config', configRouter);
  app.use('/api/suite', suiteRouter);
  app.use('/api/results', resultsRouter);
  app.use('/api/runs', runsRouter);

  // Serve UI static files
  app.use(express.static(uiDir));

  // SPA fallback — serve index.html for all unmatched GET requests
  app.get('{*path}', (_req, res) => {
    res.sendFile(resolve(uiDir, 'index.html'));
  });

  const server = http.createServer(app);

  return server;
}
