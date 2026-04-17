// Domain types shared with the server (pure interfaces, no runtime code)
import type { SolutionFile, TestCase, TokenResult, TokenAnalysis, JudgeScore, TestResult, AggregateResults } from '../../src/types.js';
export type { SolutionFile, TestCase, TokenResult, TokenAnalysis, JudgeScore, TestResult, AggregateResults };

// UI-specific types
export interface Config { [key: string]: unknown; }
export interface TargetResults {
  target: string;
  testResults: TestResult[];
  aggregates: AggregateResults;
}

// API functions
const BASE = '';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(`${BASE}${url}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function putJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function deleteJson<T>(url: string): Promise<T> {
  const res = await fetch(`${BASE}${url}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// Config
export const getConfig = () => fetchJson<Config>('/api/config');
export const putConfig = (config: Config) => putJson<{ ok: boolean }>('/api/config', config);

// Suite
export const getSuite = () => fetchJson<TestCase[]>('/api/suite');
export const getTestCase = (id: string) => fetchJson<TestCase>(`/api/suite/${id}`);
export const putTestCase = (id: string, tc: TestCase) => putJson<{ ok: boolean }>(`/api/suite/${id}`, tc);
export const createTestCase = (tc: Partial<TestCase>) => postJson<TestCase>('/api/suite', tc);
export const deleteTestCase = (id: string) => deleteJson<{ ok: boolean }>(`/api/suite/${id}`);

// Results
export const getAllResults = () => fetchJson<{ targets: TargetResults[] }>('/api/results');
export const getTestResult = (target: string, testId: string) => fetchJson<{
  tokenAnalysis: TokenAnalysis | null;
  judgeScore: JudgeScore | null;
  generatedSolution: SolutionFile[] | null;
  agentOutput: string | null;
  agentCmd: string | null;
  setupLog: string | null;
  agentNotes: string | null;
}>(`/api/results/${target}/${testId}`);

