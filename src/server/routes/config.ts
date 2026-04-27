import { Router } from 'express';
import { readFile, writeFile } from 'node:fs/promises';
import { validateConfig } from '../../core/config.js';
import type { ProjectPaths } from '../../types.js';

const router = Router();

router.get('/', async (req, res) => {
  const paths = req.app.locals['paths'] as ProjectPaths;
  try {
    const raw = await readFile(paths.config, 'utf-8');
    const data: unknown = JSON.parse(raw);
    res.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(404).json({ error: `Could not read config: ${message}` });
  }
});

router.put('/', async (req, res) => {
  const paths = req.app.locals['paths'] as ProjectPaths;
  try {
    validateConfig(req.body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: `Invalid config: ${message}` });
    return;
  }
  try {
    await writeFile(paths.config, JSON.stringify(req.body, null, 2), 'utf-8');
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Could not write config: ${message}` });
  }
});

export default router;
