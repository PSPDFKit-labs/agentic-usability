import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { TestCase, SolutionFile, ProjectPaths } from '../types.js';

export async function loadTestSuite(paths: ProjectPaths): Promise<TestCase[]> {
  let raw: string;
  try {
    raw = await readFile(paths.suite, 'utf-8');
  } catch {
    throw new Error(
      `Test suite not found at ${paths.suite}. Run 'agentic-usability generate' first.`,
    );
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Test suite at ${paths.suite} is not a JSON array`);
  }
  return parsed as TestCase[];
}

export async function loadSolution(
  paths: ProjectPaths,
  testId: string,
  target?: string,
): Promise<SolutionFile[] | null> {
  const dir = target
    ? join(paths.results, target, testId)
    : join(paths.results, testId);
  try {
    const raw = await readFile(join(dir, 'generated-solution.json'), 'utf-8');
    return JSON.parse(raw) as SolutionFile[];
  } catch {
    return null;
  }
}

export async function saveResult(
  paths: ProjectPaths,
  testId: string,
  filename: string,
  content: string,
  target?: string,
): Promise<void> {
  const dir = target
    ? join(paths.results, target, testId)
    : join(paths.results, testId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), content, 'utf-8');
}

export function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return minutes > 0 ? `${minutes}m${secs}s` : `${secs}s`;
}
