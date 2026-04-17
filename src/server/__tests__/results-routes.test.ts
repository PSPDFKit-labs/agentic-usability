import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { makeProjectPaths, makeTestCase, makeConfig } from '../../__tests__/helpers/fixtures.js';
import type { TestResult, AggregateResults } from '../../types.js';

vi.mock('../../core/config.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../../core/suite-io.js', () => ({
  loadTestSuite: vi.fn(),
}));

vi.mock('../../core/results.js', () => ({
  loadAllResults: vi.fn(),
  computeAggregates: vi.fn(),
  loadJsonFile: vi.fn(),
  loadTextFile: vi.fn(),
}));

vi.mock('../../core/runs.js', () => ({
  getLatestRunId: vi.fn(),
}));

vi.mock('../../core/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/paths.js')>();
  return {
    ...actual,
    resolveRunPaths: vi.fn(),
  };
});

import { loadConfig } from '../../core/config.js';
import { loadTestSuite } from '../../core/suite-io.js';
import { loadAllResults, computeAggregates, loadJsonFile, loadTextFile } from '../../core/results.js';
import { getLatestRunId } from '../../core/runs.js';
import { resolveRunPaths } from '../../core/paths.js';
import router from '../routes/results.js';

const paths = makeProjectPaths();

// Run-scoped paths returned by resolveRunPaths
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
    testId: 'TC-001',
    difficulty: 'easy',
    problemStatement: 'Write a function that adds two numbers',
    targetApis: ['add'],
    expectedTokens: ['export'],
    tokenAnalysis: {
      testId: 'TC-001',
      target: 'claude',
      apis: [{ token: 'add', found: true }],
      tokens: [{ token: 'export', found: true }],
      apiCoverage: 100,
      tokenCoverage: 100,
    },
    judgeScore: {
      testId: 'TC-001',
      target: 'claude',
      apiDiscovery: 90,
      callCorrectness: 85,
      completeness: 80,
      functionalCorrectness: 88,
      overallVerdict: true,
      notes: 'good',
    },
    generatedSolution: [{ path: 'solution.ts', content: 'export const add = (a, b) => a + b;' }],
    agentNotes: null,
    ...overrides,
  };
}

function makeAggregates(target: string, testResults: TestResult[]): AggregateResults {
  return {
    target,
    testResults,
    avgApiCoverage: 100,
    avgTokenCoverage: 100,
    avgApiDiscovery: 90,
    avgCallCorrectness: 85,
    avgCompleteness: 80,
    avgFunctionalCorrectness: 88,
    passRate: 100,
    byDifficulty: { easy: { avgApiCoverage: 100, avgTokenCoverage: 100, avgApiDiscovery: 90, avgCallCorrectness: 85, avgCompleteness: 80, avgFunctionalCorrectness: 88, passRate: 100, count: 1 } },
    worstApis: [],
    missedTokens: [],
  };
}

describe('GET /results', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getLatestRunId).mockResolvedValue('run-latest');
    vi.mocked(resolveRunPaths).mockReturnValue(runPaths);
  });

  it('returns targets with results and aggregates', async () => {
    const config = makeConfig({ targets: [{ name: 'claude', image: 'node:20' }] });
    const testCases = [makeTestCase({ id: 'TC-001' })];
    const testResults = [makeTestResult()];
    const aggregates = makeAggregates('claude', testResults);

    vi.mocked(loadConfig).mockResolvedValue(config);
    vi.mocked(loadTestSuite).mockResolvedValue(testCases);
    vi.mocked(loadAllResults).mockResolvedValue(testResults);
    vi.mocked(computeAggregates).mockReturnValue(aggregates);

    const app = createApp();
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('targets');
    expect(res.body.targets).toHaveLength(1);
    expect(res.body.targets[0].target).toBe('claude');
    expect(res.body.targets[0].testResults).toHaveLength(1);
    expect(res.body.targets[0].aggregates.avgApiCoverage).toBe(100);
  });

  it('returns empty targets when no runs exist', async () => {
    vi.mocked(getLatestRunId).mockResolvedValue(null);

    const app = createApp();
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ targets: [] });
  });

  it('calls loadAllResults and computeAggregates for each target', async () => {
    const config = makeConfig({
      targets: [
        { name: 'claude', image: 'node:20' },
        { name: 'gpt4', image: 'node:20' },
      ],
    });
    const testCases = [makeTestCase()];
    const testResults = [makeTestResult()];

    vi.mocked(loadConfig).mockResolvedValue(config);
    vi.mocked(loadTestSuite).mockResolvedValue(testCases);
    vi.mocked(loadAllResults).mockResolvedValue(testResults);
    vi.mocked(computeAggregates).mockReturnValue(makeAggregates('claude', testResults));

    const app = createApp();
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.body.targets).toHaveLength(2);
    expect(loadAllResults).toHaveBeenCalledTimes(2);
    expect(computeAggregates).toHaveBeenCalledTimes(2);
  });

  it('returns 500 when loading config fails', async () => {
    vi.mocked(loadConfig).mockRejectedValue(new Error('config error'));

    const app = createApp();
    const res = await request(app).get('/');

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toContain('Could not load results');
  });
});

describe('GET /results/:target', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getLatestRunId).mockResolvedValue('run-latest');
    vi.mocked(resolveRunPaths).mockReturnValue(runPaths);
  });

  it('returns single target results', async () => {
    const testCases = [makeTestCase({ id: 'TC-001' })];
    const testResults = [makeTestResult()];
    const aggregates = makeAggregates('claude', testResults);

    vi.mocked(loadTestSuite).mockResolvedValue(testCases);
    vi.mocked(loadAllResults).mockResolvedValue(testResults);
    vi.mocked(computeAggregates).mockReturnValue(aggregates);

    const app = createApp();
    const res = await request(app).get('/claude');

    expect(res.status).toBe(200);
    expect(res.body.target).toBe('claude');
    expect(res.body.testResults).toHaveLength(1);
    expect(res.body.aggregates).toBeDefined();
    expect(loadAllResults).toHaveBeenCalledWith(runPaths, testCases, 'claude');
    expect(computeAggregates).toHaveBeenCalledWith(testResults, 'claude');
  });

  it('returns 500 when loading suite fails', async () => {
    vi.mocked(loadTestSuite).mockRejectedValue(new Error('suite error'));

    const app = createApp();
    const res = await request(app).get('/claude');

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toContain('Could not load results for target "claude"');
  });
});

describe('GET /results/:target/:testId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getLatestRunId).mockResolvedValue('run-latest');
    vi.mocked(resolveRunPaths).mockReturnValue(runPaths);
  });

  it('returns detail files for a test case', async () => {
    const tokenAnalysis = {
      testId: 'TC-001',
      target: 'claude',
      apis: [{ token: 'add', found: true }],
      tokens: [{ token: 'export', found: true }],
      apiCoverage: 100,
      tokenCoverage: 100,
    };
    const judgeScore = {
      testId: 'TC-001',
      target: 'claude',
      apiDiscovery: 90,
      callCorrectness: 85,
      completeness: 80,
      functionalCorrectness: 88,
      overallVerdict: true,
      notes: 'good',
    };
    const generatedSolution = [{ path: 'solution.ts', content: 'code' }];

    vi.mocked(loadJsonFile)
      .mockResolvedValueOnce(tokenAnalysis)
      .mockResolvedValueOnce(judgeScore)
      .mockResolvedValueOnce(generatedSolution);
    vi.mocked(loadTextFile).mockResolvedValue(null);

    const app = createApp();
    const res = await request(app).get('/claude/TC-001');

    expect(res.status).toBe(200);
    expect(res.body.tokenAnalysis).toMatchObject({ testId: 'TC-001', apiCoverage: 100 });
    expect(res.body.judgeScore).toMatchObject({ overallVerdict: true });
    expect(res.body.generatedSolution).toHaveLength(1);
  });

  it('passes null values through when detail files are missing', async () => {
    vi.mocked(loadJsonFile)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    vi.mocked(loadTextFile).mockResolvedValue(null);

    const app = createApp();
    const res = await request(app).get('/claude/TC-001');

    expect(res.status).toBe(200);
    expect(res.body.tokenAnalysis).toBeNull();
    expect(res.body.judgeScore).toBeNull();
    expect(res.body.generatedSolution).toBeNull();
    expect(res.body.agentOutput).toBeNull();
    expect(res.body.agentCmd).toBeNull();
    expect(res.body.setupLog).toBeNull();
    expect(res.body.agentNotes).toBeNull();
  });

  it('calls loadJsonFile and loadTextFile with correct paths', async () => {
    vi.mocked(loadJsonFile).mockResolvedValue(null);
    vi.mocked(loadTextFile).mockResolvedValue(null);

    const app = createApp();
    await request(app).get('/claude/TC-001');

    const expectedDir = `${runPaths.results}/claude/TC-001`;
    expect(loadJsonFile).toHaveBeenCalledWith(`${expectedDir}/token-analysis.json`);
    expect(loadJsonFile).toHaveBeenCalledWith(`${expectedDir}/judge.json`);
    expect(loadJsonFile).toHaveBeenCalledWith(`${expectedDir}/generated-solution.json`);
    expect(loadTextFile).toHaveBeenCalledWith(`${expectedDir}/agent-output.log`);
    expect(loadTextFile).toHaveBeenCalledWith(`${expectedDir}/agent-cmd.log`);
    expect(loadTextFile).toHaveBeenCalledWith(`${expectedDir}/setup.log`);
    expect(loadTextFile).toHaveBeenCalledWith(`${expectedDir}/agent-notes.md`);
  });
});
