import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { Config, TestCase, SolutionFile } from './types.js';

export const DEFAULT_SUITE_FILE = '.agentic-usability/suite.json';
export const RESULTS_DIR = '.agentic-usability/results';

export async function loadTestSuite(config: Config): Promise<TestCase[]> {
  const suiteFile = resolve(config.output?.suiteFile ?? DEFAULT_SUITE_FILE);
  let raw: string;
  try {
    raw = await readFile(suiteFile, 'utf-8');
  } catch {
    throw new Error(
      `Test suite not found at ${suiteFile}. Run 'agentic-usability generate' first.`,
    );
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Test suite at ${suiteFile} is not a JSON array`);
  }
  return parsed as TestCase[];
}

export async function loadSolution(
  testId: string,
  target?: string,
): Promise<SolutionFile[] | null> {
  const dir = target
    ? resolve(join(RESULTS_DIR, target, testId))
    : resolve(join(RESULTS_DIR, testId));
  try {
    const raw = await readFile(join(dir, 'generated-solution.json'), 'utf-8');
    return JSON.parse(raw) as SolutionFile[];
  } catch {
    return null;
  }
}

export async function saveResult(
  testId: string,
  filename: string,
  content: string,
  target?: string,
): Promise<void> {
  const dir = target
    ? resolve(join(RESULTS_DIR, target, testId))
    : resolve(join(RESULTS_DIR, testId));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), content, 'utf-8');
}

export function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return minutes > 0 ? `${minutes}m${secs}s` : `${secs}s`;
}
