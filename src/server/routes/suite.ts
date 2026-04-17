import { Router } from 'express';
import { readFile, writeFile } from 'node:fs/promises';
import { validateTestSuite } from '../../commands/suite-utils.js';
import type { ProjectPaths } from '../../types.js';
import type { TestCase } from '../../types.js';

const router = Router();

async function readSuite(paths: ProjectPaths): Promise<TestCase[]> {
  const raw = await readFile(paths.suite, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('Suite file is not a JSON array');
  }
  return parsed as TestCase[];
}

async function writeSuite(paths: ProjectPaths, suite: TestCase[]): Promise<void> {
  await writeFile(paths.suite, JSON.stringify(suite, null, 2), 'utf-8');
}

function nextId(suite: TestCase[]): string {
  let max = 0;
  for (const tc of suite) {
    const m = tc.id.match(/^TC-(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return `TC-${String(max + 1).padStart(3, '0')}`;
}

// GET / — return full suite
router.get('/', async (req, res) => {
  const paths = req.app.locals['paths'] as ProjectPaths;
  try {
    const suite = await readSuite(paths);
    res.json(suite);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(404).json({ error: `Could not read suite: ${message}` });
  }
});

// PUT / — replace full suite
router.put('/', async (req, res) => {
  const paths = req.app.locals['paths'] as ProjectPaths;
  try {
    validateTestSuite(req.body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: `Invalid suite: ${message}` });
    return;
  }
  try {
    const suite = req.body as TestCase[];
    await writeSuite(paths, suite);
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Could not write suite: ${message}` });
  }
});

// POST / — append a new test case
router.post('/', async (req, res) => {
  const paths = req.app.locals['paths'] as ProjectPaths;
  try {
    const suite = await readSuite(paths);
    const newCase = req.body as Omit<TestCase, 'id'> & { id?: string };
    const id = newCase.id ?? nextId(suite);
    const testCase: TestCase = { ...newCase, id } as TestCase;
    validateTestSuite([testCase]);
    suite.push(testCase);
    await writeSuite(paths, suite);
    res.status(201).json(testCase);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Could not append test case: ${message}` });
  }
});

// GET /:id — get a single test case
router.get('/:id', async (req, res) => {
  const paths = req.app.locals['paths'] as ProjectPaths;
  try {
    const suite = await readSuite(paths);
    const tc = suite.find((t) => t.id === req.params['id']);
    if (!tc) {
      res.status(404).json({ error: `Test case ${req.params['id']} not found` });
      return;
    }
    res.json(tc);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Could not read suite: ${message}` });
  }
});

// PUT /:id — replace a single test case
router.put('/:id', async (req, res) => {
  const paths = req.app.locals['paths'] as ProjectPaths;
  try {
    const suite = await readSuite(paths);
    const idx = suite.findIndex((t) => t.id === req.params['id']);
    if (idx === -1) {
      res.status(404).json({ error: `Test case ${req.params['id']} not found` });
      return;
    }
    const updated: TestCase = { ...(req.body as TestCase), id: req.params['id']! };
    suite[idx] = updated;
    await writeSuite(paths, suite);
    res.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Could not update test case: ${message}` });
  }
});

// DELETE /:id — remove a test case
router.delete('/:id', async (req, res) => {
  const paths = req.app.locals['paths'] as ProjectPaths;
  try {
    const suite = await readSuite(paths);
    const idx = suite.findIndex((t) => t.id === req.params['id']);
    if (idx === -1) {
      res.status(404).json({ error: `Test case ${req.params['id']} not found` });
      return;
    }
    suite.splice(idx, 1);
    await writeSuite(paths, suite);
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Could not delete test case: ${message}` });
  }
});

export default router;
