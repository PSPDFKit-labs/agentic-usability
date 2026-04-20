import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { makeProjectPaths, makeTestCase, makeConfig } from '../../__tests__/helpers/fixtures.js';
import type { TestResult, AggregateResults } from '../../types.js';

vi.mock('../../core/config.js', () => ({ loadConfig: vi.fn() }));
vi.mock('../../core/suite-io.js', () => ({ loadTestSuite: vi.fn() }));
vi.mock('../../core/results.js', () => ({ loadAllResults: vi.fn(), computeAggregates: vi.fn(), loadJsonFile: vi.fn(), loadTextFile: vi.fn() }));
vi.mock('../../core/runs.js', () => ({ getLatestRunId: vi.fn() }));
vi.mock('../../core/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/paths.js')>();
  return { ...actual, resolveRunPaths: vi.fn() };
});

import { loadConfig } from '../../core/config.js';
import { loadTestSuite } from '../../core/suite-io.js';
import { loadAllResults, computeAggregates, loadJsonFile, loadTextFile } from '../../core/results.js';
import { getLatestRunId } from '../../core/runs.js';
import { resolveRunPaths } from '../../core/paths.js';
import router from '../routes/results.js';

const paths = makeProjectPaths();
const runPaths = { ...paths, results: `${paths.results}/run-latest`, pipelineState: `${paths.results}/run-latest/pipeline-state.json` };

function createApp() {
  const app = express();
  app.use(express.json());
  app.locals['paths'] = paths;
  app.use('/', router);
  return app;
}

function makeTestResult(overrides: Partial<TestResult> = {}): TestResult {
  return {
    testId: 'TC-001', difficulty: 'easy', problemStatement: 'Write a function that adds two numbers',
    judgeScore: { testId: 'TC-001', target: 'claude', apiDiscovery: 90, callCorrectness: 85, completeness: 80, functionalCorrectness: 88, overallVerdict: true, notes: 'good' },
    generatedSolution: [{ path: 'solution.ts', content: 'export const add = (a, b) => a + b;' }],
    agentNotes: null, ...overrides,
  };
}

function makeAggregates(target: string, testResults: TestResult[]): AggregateResults {
  return {
    target, testResults, avgApiDiscovery: 90, avgCallCorrectness: 85, avgCompleteness: 80, avgFunctionalCorrectness: 88, passRate: 100,
    byDifficulty: { easy: { avgApiDiscovery: 90, avgCallCorrectness: 85, avgCompleteness: 80, avgFunctionalCorrectness: 88, passRate: 100, count: 1 } },
  };
}

describe('GET /results', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(getLatestRunId).mockResolvedValue('run-latest'); vi.mocked(resolveRunPaths).mockReturnValue(runPaths); });

  it('returns targets with results and aggregates', async () => {
    vi.mocked(loadConfig).mockResolvedValue(makeConfig({ targets: [{ name: 'claude', image: 'node:20' }] }));
    vi.mocked(loadTestSuite).mockResolvedValue([makeTestCase()]);
    vi.mocked(loadAllResults).mockResolvedValue([makeTestResult()]);
    vi.mocked(computeAggregates).mockReturnValue(makeAggregates('claude', [makeTestResult()]));
    const res = await request(createApp()).get('/');
    expect(res.status).toBe(200);
    expect(res.body.targets).toHaveLength(1);
    expect(res.body.targets[0].aggregates.avgApiDiscovery).toBe(90);
  });

  it('returns empty targets when no runs exist', async () => {
    vi.mocked(getLatestRunId).mockResolvedValue(null);
    const res = await request(createApp()).get('/');
    expect(res.body).toEqual({ targets: [] });
  });
});

describe('GET /results/:target', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(getLatestRunId).mockResolvedValue('run-latest'); vi.mocked(resolveRunPaths).mockReturnValue(runPaths); });

  it('returns single target results', async () => {
    vi.mocked(loadTestSuite).mockResolvedValue([makeTestCase()]);
    vi.mocked(loadAllResults).mockResolvedValue([makeTestResult()]);
    vi.mocked(computeAggregates).mockReturnValue(makeAggregates('claude', [makeTestResult()]));
    const res = await request(createApp()).get('/claude');
    expect(res.status).toBe(200);
    expect(res.body.target).toBe('claude');
  });
});

describe('GET /results/:target/:testId', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(getLatestRunId).mockResolvedValue('run-latest'); vi.mocked(resolveRunPaths).mockReturnValue(runPaths); });

  it('returns detail files for a test case', async () => {
    vi.mocked(loadJsonFile).mockResolvedValueOnce({ overallVerdict: true }).mockResolvedValueOnce([{ path: 'a.ts', content: 'code' }]);
    vi.mocked(loadTextFile).mockResolvedValue(null);
    const res = await request(createApp()).get('/claude/TC-001');
    expect(res.status).toBe(200);
    expect(res.body.judgeScore).toMatchObject({ overallVerdict: true });
  });

  it('passes null values through when files are missing', async () => {
    vi.mocked(loadJsonFile).mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    vi.mocked(loadTextFile).mockResolvedValue(null);
    const res = await request(createApp()).get('/claude/TC-001');
    expect(res.body.judgeScore).toBeNull();
    expect(res.body.generatedSolution).toBeNull();
  });

  it('calls loadJsonFile with correct paths', async () => {
    vi.mocked(loadJsonFile).mockResolvedValue(null);
    vi.mocked(loadTextFile).mockResolvedValue(null);
    await request(createApp()).get('/claude/TC-001');
    const dir = `${runPaths.results}/claude/TC-001`;
    expect(loadJsonFile).toHaveBeenCalledWith(`${dir}/judge.json`);
    expect(loadJsonFile).toHaveBeenCalledWith(`${dir}/generated-solution.json`);
  });
});
