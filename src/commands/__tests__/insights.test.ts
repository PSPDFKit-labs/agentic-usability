import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeConfig, makeTestCase, makeProjectPaths } from '../../__tests__/helpers/fixtures.js';
import type { AggregateResults, TestResult } from '../../core/results.js';
import type { TokenAnalysis, JudgeScore } from '../../core/types.js';

vi.mock('../../core/config.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../../core/source-resolver.js', () => ({
  resolveSources: vi.fn(),
}));

vi.mock('../../core/suite-io.js', () => ({
  loadTestSuite: vi.fn(),
}));

vi.mock('../../core/results.js', () => ({
  loadAllResults: vi.fn(),
  computeAggregates: vi.fn(),
}));

vi.mock('../../agents/adapter.js', () => ({
  createAdapter: vi.fn(),
}));

vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
  })),
}));

import { loadConfig } from '../../core/config.js';
import { resolveSources } from '../../core/source-resolver.js';
import { loadTestSuite } from '../../core/suite-io.js';
import { loadAllResults, computeAggregates } from '../../core/results.js';
import { createAdapter } from '../../agents/adapter.js';
import { insightsCommand, buildInsightsPrompt } from '../insights.js';

const paths = makeProjectPaths();

function makeTokenAnalysis(overrides: Partial<TokenAnalysis> = {}): TokenAnalysis {
  return {
    testId: 'TC-001',
    target: 'claude',
    apis: [{ token: 'add', found: true, foundIn: 'solution.ts' }],
    tokens: [{ token: 'export', found: true, foundIn: 'solution.ts' }],
    apiCoverage: 100,
    tokenCoverage: 100,
    ...overrides,
  };
}

function makeJudgeScore(overrides: Partial<JudgeScore> = {}): JudgeScore {
  return {
    testId: 'TC-001',
    target: 'claude',
    apiDiscovery: 90,
    callCorrectness: 85,
    completeness: 80,
    functionalCorrectness: 75,
    overallVerdict: true,
    notes: 'Good solution',
    ...overrides,
  };
}

function makeTestResult(overrides: Partial<TestResult> = {}): TestResult {
  return {
    testId: 'TC-001',
    difficulty: 'easy',
    problemStatement: 'Write a function that adds two numbers',
    targetApis: ['add'],
    expectedTokens: ['export'],
    tokenAnalysis: makeTokenAnalysis(),
    judgeScore: makeJudgeScore(),
    generatedSolution: [{ path: 'solution.ts', content: 'code' }],
    agentNotes: null,
    ...overrides,
  };
}

function makeAggregates(overrides: Partial<AggregateResults> = {}): AggregateResults {
  return {
    target: 'claude',
    testResults: [makeTestResult()],
    avgApiCoverage: 100,
    avgTokenCoverage: 100,
    avgApiDiscovery: 90,
    avgCallCorrectness: 85,
    avgCompleteness: 80,
    avgFunctionalCorrectness: 75,
    passRate: 100,
    byDifficulty: {
      easy: {
        count: 1,
        avgApiCoverage: 100,
        avgTokenCoverage: 100,
        avgApiDiscovery: 90,
        avgCallCorrectness: 85,
        avgCompleteness: 80,
        avgFunctionalCorrectness: 75,
        passRate: 100,
      },
    },
    worstApis: [{ api: 'subtract', missRate: 100, missCount: 1, totalCount: 1 }],
    missedTokens: [{ token: 'import.*sdk', missRate: 50, missCount: 1, totalCount: 2 }],
    ...overrides,
  };
}

function makeAdapter(overrides: Record<string, unknown> = {}) {
  return {
    name: 'test',
    installCommand: null,
    run: vi.fn(),
    interactive: vi.fn(),
    sandboxCommand: vi.fn().mockReturnValue(''),
    ...overrides,
  };
}

describe('insightsCommand', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    vi.mocked(loadConfig).mockResolvedValue(makeConfig());
    vi.mocked(resolveSources).mockResolvedValue(['/tmp/sdk']);
    vi.mocked(loadTestSuite).mockResolvedValue([makeTestCase()]);
    vi.mocked(loadAllResults).mockResolvedValue([makeTestResult()]);
    vi.mocked(computeAggregates).mockReturnValue(makeAggregates());
  });

  it('loads config, resolves sources, loads results, and launches interactive session', async () => {
    const adapter = makeAdapter();
    adapter.interactive.mockResolvedValue({ exitCode: 0, durationMs: 5000 });
    vi.mocked(createAdapter).mockReturnValue(adapter as any);

    await insightsCommand(paths);

    expect(loadConfig).toHaveBeenCalledWith(paths.config);
    expect(resolveSources).toHaveBeenCalled();
    expect(loadTestSuite).toHaveBeenCalledWith(paths);
    expect(loadAllResults).toHaveBeenCalled();
    expect(computeAggregates).toHaveBeenCalled();
    expect(adapter.interactive).toHaveBeenCalledWith(
      expect.any(String),
      paths.root,
    );
  });

  it('exits early when no results are available', async () => {
    vi.mocked(computeAggregates).mockReturnValue(makeAggregates({
      testResults: [makeTestResult({ tokenAnalysis: null, judgeScore: null })],
    }));

    const adapter = makeAdapter();
    vi.mocked(createAdapter).mockReturnValue(adapter as any);

    await insightsCommand(paths);

    expect(adapter.interactive).not.toHaveBeenCalled();
  });

  it('uses project root as workDir', async () => {
    const adapter = makeAdapter();
    adapter.interactive.mockResolvedValue({ exitCode: 0, durationMs: 1000 });
    vi.mocked(createAdapter).mockReturnValue(adapter as any);

    await insightsCommand(paths);

    expect(adapter.interactive).toHaveBeenCalledWith(
      expect.any(String),
      paths.root,
    );
  });
});

describe('buildInsightsPrompt', () => {
  const config = makeConfig({ publicInfo: { packageName: 'my-sdk', docsUrl: 'https://docs.example.com' } });
  const allAggregates = [makeAggregates()];

  it('contains source paths', () => {
    const prompt = buildInsightsPrompt(['/tmp/sdk'], config, allAggregates, paths);
    expect(prompt).toContain('/tmp/sdk');
  });

  it('contains the package name', () => {
    const prompt = buildInsightsPrompt(['/tmp/sdk'], config, allAggregates, paths);
    expect(prompt).toContain('my-sdk');
  });

  it('contains scoring methodology explanation', () => {
    const prompt = buildInsightsPrompt(['/tmp/sdk'], config, allAggregates, paths);
    expect(prompt).toContain('API Coverage');
    expect(prompt).toContain('Token Coverage');
    expect(prompt).toContain('API Discovery');
    expect(prompt).toContain('Call Correctness');
    expect(prompt).toContain('Completeness');
    expect(prompt).toContain('Functional Correctness');
    expect(prompt).toContain('overallVerdict');
  });

  it('contains difficulty rubric from generator', () => {
    const prompt = buildInsightsPrompt(['/tmp/sdk'], config, allAggregates, paths);
    expect(prompt).toContain('directly demonstrated in public documentation');
    expect(prompt).toContain('single-function level');
    expect(prompt).toContain('multi-function level');
  });

  it('contains judge scoring bands', () => {
    const prompt = buildInsightsPrompt(['/tmp/sdk'], config, allAggregates, paths);
    expect(prompt).toContain('0-20');
    expect(prompt).toContain('81-100');
    expect(prompt).toContain('Used completely wrong or unrelated APIs');
    expect(prompt).toContain('Runs correctly and produces expected output');
  });

  it('contains aggregate stats', () => {
    const prompt = buildInsightsPrompt(['/tmp/sdk'], config, allAggregates, paths);
    expect(prompt).toContain('100%'); // API Coverage
    expect(prompt).toContain('Pass Rate');
  });

  it('contains worst APIs and missed tokens', () => {
    const prompt = buildInsightsPrompt(['/tmp/sdk'], config, allAggregates, paths);
    expect(prompt).toContain('subtract');
    expect(prompt).toContain('import.*sdk');
  });

  it('contains per-test-case results with judge notes', () => {
    const prompt = buildInsightsPrompt(['/tmp/sdk'], config, allAggregates, paths);
    expect(prompt).toContain('TC-001');
    expect(prompt).toContain('adds two numbers');
    expect(prompt).toContain('Good solution');
  });

  it('contains file path hints for deep dives', () => {
    const prompt = buildInsightsPrompt(['/tmp/sdk'], config, allAggregates, paths);
    expect(prompt).toContain('generated-solution.json');
    expect(prompt).toContain('token-analysis.json');
    expect(prompt).toContain('judge.json');
    expect(prompt).toContain(paths.suite);
  });

  it('contains instructions for the agent', () => {
    const prompt = buildInsightsPrompt(['/tmp/sdk'], config, allAggregates, paths);
    expect(prompt).toContain('Failure Patterns');
    expect(prompt).toContain('Documentation Gaps');
    expect(prompt).toContain('API Design Issues');
    expect(prompt).toContain('Prioritized Recommendations');
  });
});
