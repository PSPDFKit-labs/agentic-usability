import chalk from 'chalk';
import ora from 'ora';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { loadConfig, ensureWorkingDir } from '../core/config.js';
import { analyzeTokens } from '../scoring/tokens.js';
import type { Config, TestCase, SolutionFile, TokenAnalysis } from '../core/types.js';

const DEFAULT_SUITE_FILE = '.agentic-usability/suite.json';
const RESULTS_DIR = '.agentic-usability/results';

async function loadTestSuite(config: Config): Promise<TestCase[]> {
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

async function loadSolution(testId: string): Promise<SolutionFile[] | null> {
  const filePath = resolve(join(RESULTS_DIR, testId, 'generated-solution.json'));
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as SolutionFile[];
  } catch {
    return null;
  }
}

export async function analyzeCommand(): Promise<void> {
  const config = await loadConfig();
  await ensureWorkingDir();

  const spinner = ora('Loading test suite...').start();
  const testCases = await loadTestSuite(config);
  spinner.succeed(`Loaded ${testCases.length} test case(s)`);

  const target = config.targets[0];

  console.log(chalk.bold(`\nAnalyzing solutions for target: ${target.name}\n`));

  for (const tc of testCases) {
    const solution = await loadSolution(tc.id);

    if (!solution) {
      console.log(
        chalk.yellow(`${tc.id}: No solution found — skipping (0% coverage)`),
      );

      const emptyAnalysis: TokenAnalysis = analyzeTokens(
        [],
        tc.targetApis,
        tc.expectedTokens,
        tc.id,
        target.name,
      );

      const dir = resolve(join(RESULTS_DIR, tc.id));
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, 'token-analysis.json'),
        JSON.stringify(emptyAnalysis, null, 2),
        'utf-8',
      );
      continue;
    }

    const analysis = analyzeTokens(
      solution,
      tc.targetApis,
      tc.expectedTokens,
      tc.id,
      target.name,
    );

    const dir = resolve(join(RESULTS_DIR, tc.id));
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'token-analysis.json'),
      JSON.stringify(analysis, null, 2),
      'utf-8',
    );

    const apiTotal = tc.targetApis.length;
    const apiFound = analysis.apis.filter((a) => a.found).length;
    const tokenTotal = tc.expectedTokens.length;
    const tokenFound = analysis.tokens.filter((t) => t.found).length;

    console.log(
      `${tc.id}: API ${Math.round(analysis.apiCoverage)}% (${apiFound}/${apiTotal}), Tokens ${Math.round(analysis.tokenCoverage)}% (${tokenFound}/${tokenTotal})`,
    );
  }

  console.log(chalk.dim(`\nResults saved to ${resolve(RESULTS_DIR)}`));
}
