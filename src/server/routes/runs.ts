import { Router } from 'express';
import { join } from 'node:path';
import { listRuns, loadRunInfo, saveRunInfo, deleteRun } from '../../core/runs.js';
import { loadAllResults, computeAggregates, loadJsonFile, loadTextFile } from '../../core/results.js';
import { loadConfig } from '../../core/config.js';
import { loadTestSuite } from '../../core/suite-io.js';
import { resolveRunPaths } from '../../core/paths.js';
import type { ProjectPaths } from '../../types.js';
import type { JudgeScore, SolutionFile } from '../../types.js';

const router = Router();

/** Reject path segments containing traversal characters. */
function safeName(s: string): string | null {
  if (!s || s.includes('..') || s.includes('/') || s.includes('\\') || s.includes('\0')) return null;
  return s;
}

// GET / — list all runs
router.get('/', async (req, res) => {
  const paths = req.app.locals['paths'] as ProjectPaths;
  try {
    const runs = await listRuns(paths.results);
    res.json(runs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Could not list runs: ${message}` });
  }
});

// GET /:runId — single run metadata
router.get('/:runId', async (req, res) => {
  const paths = req.app.locals['paths'] as ProjectPaths;
  const runId = safeName(req.params['runId']!);
  if (!runId) { res.status(400).json({ error: 'Invalid run ID' }); return; }
  try {
    const info = await loadRunInfo(join(paths.results, runId));
    if (!info) { res.status(404).json({ error: `Run not found: ${runId}` }); return; }
    res.json(info);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// PATCH /:runId — update label
router.patch('/:runId', async (req, res) => {
  const paths = req.app.locals['paths'] as ProjectPaths;
  const runId = safeName(req.params['runId']!);
  if (!runId) { res.status(400).json({ error: 'Invalid run ID' }); return; }
  try {
    const runDir = join(paths.results, runId);
    const info = await loadRunInfo(runDir);
    if (!info) { res.status(404).json({ error: `Run not found: ${runId}` }); return; }
    if (req.body.label !== undefined) {
      info.label = req.body.label;
    }
    await saveRunInfo(runDir, info);
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// DELETE /:runId — delete a run
router.delete('/:runId', async (req, res) => {
  const paths = req.app.locals['paths'] as ProjectPaths;
  const runId = safeName(req.params['runId']!);
  if (!runId) { res.status(400).json({ error: 'Invalid run ID' }); return; }
  try {
    await deleteRun(paths.results, runId);
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(404).json({ error: message });
  }
});

// GET /:runId/results — all targets for a specific run
router.get('/:runId/results', async (req, res) => {
  const paths = req.app.locals['paths'] as ProjectPaths;
  const runId = safeName(req.params['runId']!);
  if (!runId) { res.status(400).json({ error: 'Invalid run ID' }); return; }
  try {
    const runPaths = resolveRunPaths(paths, runId);
    const config = await loadConfig(paths.config);
    const testCases = await loadTestSuite(paths);

    const targets = await Promise.all(
      config.targets.map(async (t) => {
        const testResults = await loadAllResults(runPaths, testCases, t.name);
        const aggregates = computeAggregates(testResults, t.name);
        return { target: t.name, testResults, aggregates };
      })
    );

    res.json({ targets });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Could not load results: ${message}` });
  }
});

// GET /:runId/results/:target/:testId — detailed files for one test case in a run
router.get('/:runId/results/:target/:testId', async (req, res) => {
  const paths = req.app.locals['paths'] as ProjectPaths;
  const runId = safeName(req.params['runId']!);
  const target = safeName(req.params['target']!);
  const testId = safeName(req.params['testId']!);
  if (!runId || !target || !testId) { res.status(400).json({ error: 'Invalid parameters' }); return; }
  try {
    const runPaths = resolveRunPaths(paths, runId);
    const dir = join(runPaths.results, target, testId);
    const [
      judgeScore, generatedSolution, agentOutput, agentCmd, setupLog, agentNotes,
      installErrorLog, agentProxyLog, agentErrorLog, agentSessionLog,
      judgeCmdLog, judgeOutputLog, judgeSessionLog, judgeProxyLog, judgeErrorLog,
    ] = await Promise.all([
      loadJsonFile<JudgeScore>(join(dir, 'judge.json')),
      loadJsonFile<SolutionFile[]>(join(dir, 'generated-solution.json')),
      loadTextFile(join(dir, 'agent-output.log')),
      loadTextFile(join(dir, 'agent-cmd.log')),
      loadTextFile(join(dir, 'setup.log')),
      loadTextFile(join(dir, 'agent-notes.md')),
      loadTextFile(join(dir, 'install-error.log')),
      loadTextFile(join(dir, 'agent-egress.log.json')),
      loadTextFile(join(dir, 'agent-error.log')),
      loadTextFile(join(dir, 'agent-session.jsonl')),
      loadTextFile(join(dir, 'judge-cmd.log')),
      loadTextFile(join(dir, 'judge-output.log')),
      loadTextFile(join(dir, 'judge-session.jsonl')),
      loadTextFile(join(dir, 'judge-egress.log.json')),
      loadTextFile(join(dir, 'judge-error.log')),
    ]);
    res.json({
      judgeScore, generatedSolution, agentOutput, agentCmd, setupLog, agentNotes,
      installErrorLog, agentProxyLog, agentErrorLog, agentSessionLog,
      judgeCmdLog, judgeOutputLog, judgeSessionLog, judgeProxyLog, judgeErrorLog,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Could not load result files: ${message}` });
  }
});

export default router;
