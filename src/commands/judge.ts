import chalk from 'chalk';
import ora from 'ora';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { loadConfig, ensureWorkingDir } from '../core/config.js';
import { runJudge } from '../scoring/judge.js';
import type { Config, TestCase, SolutionFile } from '../core/types.js';

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

export async function judgeCommand(options: { skipJudge?: boolean } = {}): Promise<void> {
  if (options.skipJudge) {
    console.log(chalk.yellow('Judge stage skipped (--skip-judge flag)'));
    return;
  }

  const config = await loadConfig();
  await ensureWorkingDir();

  const spinner = ora('Loading test suite...').start();
  const testCases = await loadTestSuite(config);
  spinner.succeed(`Loaded ${testCases.length} test case(s)`);

  const target = config.targets[0];
  const judgeConfig = config.agents?.judge ?? { command: 'claude' };

  console.log(chalk.bold(`\nJudging solutions for target: ${target.name}\n`));

  for (const tc of testCases) {
    const solution = await loadSolution(tc.id);

    if (!solution) {
      console.log(
        chalk.yellow(`${tc.id}: No generated solution found — skipping`),
      );
      continue;
    }

    const judgeSpinner = ora(`${tc.id}: Running judge...`).start();

    try {
      const score = await runJudge(tc, solution, judgeConfig, target.name);

      const dir = resolve(join(RESULTS_DIR, tc.id));
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, 'judge.json'),
        JSON.stringify(score, null, 2),
        'utf-8',
      );

      const matchIcon = score.functionalMatch ? chalk.green('MATCH') : chalk.red('NO MATCH');
      judgeSpinner.succeed(
        `${tc.id}: Similarity ${score.overallSimilarity}%, API ${score.apiCorrectness}%, Idiomatic ${score.idiomaticUsage}% [${matchIcon}]`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      judgeSpinner.fail(`${tc.id}: Judge failed — ${message}`);

      const dir = resolve(join(RESULTS_DIR, tc.id));
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, 'judge-error.log'),
        message,
        'utf-8',
      );
    }
  }

  console.log(chalk.dim(`\nResults saved to ${resolve(RESULTS_DIR)}`));
}
