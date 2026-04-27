#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadDotenv } from './core/env.js';
import { resolveProjectPaths, resolveRunPaths, ensureProjectDirs } from './core/paths.js';
import { getLatestRunId, generateRunId } from './core/runs.js';
import { initCommand } from './commands/init.js';
import { generateCommand } from './commands/generate.js';
import { executeCommand } from './commands/execute.js';
import { judgeCommand } from './commands/judge.js';
import { reportCommand } from './commands/report.js';
import { evalCommand } from './commands/eval.js';
import { inspectCommand } from './commands/inspect.js';
import { insightsCommand } from './commands/insights.js';
import { exportCommand } from './commands/export.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

const program = new Command();

program
  .name('agentic-usability')
  .description('SDK Usability Benchmark CLI — measures how well AI agents can use an SDK')
  .version(pkg.version)
  .option('-p, --project <dir>', 'Project directory (self-contained pipeline folder)');

function getPaths(): ReturnType<typeof resolveProjectPaths> {
  const opts = program.opts<{ project?: string }>();
  return resolveProjectPaths(opts.project);
}

program
  .command('init')
  .description('Initialize a new pipeline project')
  .action(async () => {
    await initCommand(getPaths());
  });

program
  .command('generate')
  .description('Generate test suite by having an AI agent explore the SDK source')
  .option('--fresh', 'Force re-resolve source (bypass cache)')
  .option('--non-interactive', 'Run in non-interactive mode (piped stdio, no human feedback)')
  .option('--prompt-only', 'Print the agent prompt to stdout and exit')
  .action(async (opts: { fresh?: boolean; nonInteractive?: boolean; promptOnly?: boolean }) => {
    const paths = getPaths();
    await ensureProjectDirs(paths);
    await generateCommand(paths, { fresh: opts.fresh, nonInteractive: opts.nonInteractive, promptOnly: opts.promptOnly });
  });

program
  .command('execute')
  .description('Execute test cases in sandboxed environments with AI agents')
  .option('--tests <ids>', 'Comma-separated list of test case IDs to run')
  .option('--run <runId>', 'Target run (default: latest, creates new if none)')
  .action(async (opts: { tests?: string; run?: string }) => {
    await loadDotenv();
    const paths = getPaths();
    await ensureProjectDirs(paths);
    let runId = opts.run ?? await getLatestRunId(paths.results);
    if (!runId) {
      runId = generateRunId();
      console.log(chalk.dim(`No existing runs — creating new run ${runId}`));
    }
    const testIds = opts.tests?.split(',').map(s => s.trim());
    await executeCommand(resolveRunPaths(paths, runId), { testIds });
  });

program
  .command('judge')
  .description('Have an LLM compare reference and generated solutions')
  .option('--tests <ids>', 'Comma-separated list of test case IDs to run')
  .option('--run <runId>', 'Target run (default: latest)')
  .action(async (opts: { tests?: string; run?: string }) => {
    const paths = getPaths();
    await ensureProjectDirs(paths);
    const runId = opts.run ?? await getLatestRunId(paths.results);
    if (!runId) { console.error(chalk.red('No runs found. Run "execute" or "eval" first.')); process.exit(1); }
    const testIds = opts.tests?.split(',').map(s => s.trim());
    await judgeCommand(resolveRunPaths(paths, runId), { testIds });
  });

program
  .command('report')
  .description('Display a terminal scorecard of benchmark results')
  .option('--json', 'Output raw structured JSON instead of the table')
  .option('--run <runId>', 'Target run (default: latest)')
  .action(async (opts: { json?: boolean; run?: string }) => {
    const paths = getPaths();
    const runId = opts.run ?? await getLatestRunId(paths.results);
    if (!runId) { console.error(chalk.red('No runs found. Run "eval" first.')); process.exit(1); }
    await reportCommand(resolveRunPaths(paths, runId), { json: opts.json });
  });

program
  .command('eval')
  .description('Run the evaluation pipeline: execute → judge → report')
  .option('--resume', 'Resume from last checkpoint')
  .option('--fresh', 'Clear existing pipeline state before starting')
  .option('--label <name>', 'Label for this eval run')
  .option('--run <runId>', 'Resume a specific run (with --resume)')
  .option('--tests <ids>', 'Comma-separated list of test case IDs to run')
  .action(async (opts: { resume?: boolean; fresh?: boolean; label?: string; run?: string; tests?: string }) => {
    const testIds = opts.tests?.split(',').map(s => s.trim());
    await evalCommand(getPaths(), { resume: opts.resume, fresh: opts.fresh, label: opts.label, run: opts.run, testIds });
  });

program
  .command('inspect')
  .description('Open the web UI to inspect, edit, and run the pipeline')
  .option('--port <number>', 'Port for the local server', '7373')
  .action(async (opts: { port?: string }) => {
    await inspectCommand(getPaths(), { port: opts.port ? parseInt(opts.port, 10) : undefined });
  });

program
  .command('insights')
  .description('Interactive AI session to analyze pipeline results and identify SDK improvement areas')
  .option('--fresh', 'Re-resolve sources (skip cache)')
  .option('--run <runId>', 'Target run (default: latest)')
  .option('--prompt-only', 'Print the agent prompt to stdout and exit')
  .action(async (opts: { fresh?: boolean; run?: string; promptOnly?: boolean }) => {
    const paths = getPaths();
    await ensureProjectDirs(paths);
    const runId = opts.run ?? await getLatestRunId(paths.results);
    if (!runId) { console.error(chalk.red('No runs found. Run "eval" first.')); process.exit(1); }
    await insightsCommand(resolveRunPaths(paths, runId), { fresh: opts.fresh, promptOnly: opts.promptOnly });
  });

program
  .command('export')
  .description('Export a pipeline as a zip file (excludes cache and workspace snapshots)')
  .option('-o, --output <path>', 'Output zip file path')
  .option('-r, --run <runId>', 'Export only a specific run')
  .action(async (opts: { output?: string; run?: string }) => {
    await exportCommand(getPaths(), opts);
  });

program.parseAsync().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(chalk.red(`Error: ${message}`));
  process.exitCode = 1;
});
