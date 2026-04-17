import { Router } from 'express';
import { join } from 'node:path';
import { loadAllResults, computeAggregates, loadJsonFile, loadTextFile } from '../../core/results.js';
import { loadConfig } from '../../core/config.js';
import { loadTestSuite } from '../../core/suite-io.js';
import type { ProjectPaths } from '../../types.js';
import type { TokenAnalysis, JudgeScore, SolutionFile } from '../../types.js';

const router = Router();

/** Reject path segments containing traversal characters. */
function safeName(s: string): string | null {
  if (!s || s.includes('..') || s.includes('/') || s.includes('\\') || s.includes('\0')) return null;
  return s;
}

// GET / — results for all targets
router.get('/', async (req, res) => {
  const paths = req.app.locals['paths'] as ProjectPaths;
  try {
    const config = await loadConfig(paths.config);
    const testCases = await loadTestSuite(paths);

    const targets = await Promise.all(
      config.targets.map(async (t) => {
        const testResults = await loadAllResults(paths, testCases, t.name);
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

// GET /:target — results for a single target
router.get('/:target', async (req, res) => {
  const paths = req.app.locals['paths'] as ProjectPaths;
  const target = safeName(req.params['target']!);
  if (!target) { res.status(400).json({ error: 'Invalid target name' }); return; }
  try {
    const testCases = await loadTestSuite(paths);
    const testResults = await loadAllResults(paths, testCases, target);
    const aggregates = computeAggregates(testResults, target);
    res.json({ target, testResults, aggregates });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Could not load results for target "${target}": ${message}` });
  }
});

// GET /:target/:testId — detailed files for one test case
router.get('/:target/:testId', async (req, res) => {
  const paths = req.app.locals['paths'] as ProjectPaths;
  const target = safeName(req.params['target']!);
  const testId = safeName(req.params['testId']!);
  if (!target || !testId) { res.status(400).json({ error: 'Invalid target or testId' }); return; }
  try {
    const dir = join(paths.results, target, testId);
    const [tokenAnalysis, judgeScore, generatedSolution, agentOutput, agentCmd, setupLog, agentNotes] = await Promise.all([
      loadJsonFile<TokenAnalysis>(join(dir, 'token-analysis.json')),
      loadJsonFile<JudgeScore>(join(dir, 'judge.json')),
      loadJsonFile<SolutionFile[]>(join(dir, 'generated-solution.json')),
      loadTextFile(join(dir, 'agent-output.log')),
      loadTextFile(join(dir, 'agent-cmd.log')),
      loadTextFile(join(dir, 'setup.log')),
      loadTextFile(join(dir, 'agent-notes.md')),
    ]);
    res.json({ tokenAnalysis, judgeScore, generatedSolution, agentOutput, agentCmd, setupLog, agentNotes });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Could not load result files for ${target}/${testId}: ${message}` });
  }
});

export default router;
