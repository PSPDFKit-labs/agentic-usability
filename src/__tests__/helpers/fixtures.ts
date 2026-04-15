import type { TestCase, SolutionFile, Config, AgentConfig, AgentResult } from '../../core/types.js';
import type { ProjectPaths } from '../../core/paths.js';

export function makeTestCase(overrides: Partial<TestCase> = {}): TestCase {
  return {
    id: 'TC-001',
    problemStatement: 'Write a function that adds two numbers',
    referenceSolution: [{ path: 'solution.ts', content: 'export const add = (a: number, b: number) => a + b;' }],
    difficulty: 'easy',
    targetApis: ['add'],
    expectedTokens: ['export', 'function|const'],
    tags: ['math'],
    ...overrides,
  };
}

export function makeSolutionFile(overrides: Partial<SolutionFile> = {}): SolutionFile {
  return {
    path: 'solution.ts',
    content: 'export const add = (a: number, b: number) => a + b;',
    ...overrides,
  };
}

export function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    sources: [{ type: 'local', path: '/tmp/sdk' }],
    targets: [{ name: 'claude', image: 'node:20' }],
    sandbox: { domain: 'localhost:8080' },
    ...overrides,
  } as Config;
}

export function makeAgentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    command: 'claude',
    ...overrides,
  };
}

export function makeAgentResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    stdout: '',
    stderr: '',
    exitCode: 0,
    durationMs: 100,
    ...overrides,
  };
}

export function makeProjectPaths(overrides?: Partial<ProjectPaths>): ProjectPaths {
  return {
    root: '/fake/project',
    config: '/fake/project/config.json',
    suite: '/fake/project/suite.json',
    results: '/fake/project/results',
    reports: '/fake/project/reports',
    logs: '/fake/project/logs',
    cache: '/fake/project/cache',
    cacheRepos: '/fake/project/cache/repos',

    pipelineState: '/fake/project/logs/pipeline-state.json',
    ...overrides,
  };
}
