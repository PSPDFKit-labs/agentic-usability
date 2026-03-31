#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initCommand } from './commands/init.js';
import { generateCommand } from './commands/generate.js';
import { editCommand } from './commands/edit.js';
import { exportCommand } from './commands/export.js';
import { importCommand } from './commands/import.js';
import { executeCommand } from './commands/execute.js';
import { analyzeCommand } from './commands/analyze.js';
import { judgeCommand } from './commands/judge.js';
import { reportCommand, exportResultsCommand } from './commands/report.js';
import { runCommand } from './commands/run.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

const program = new Command();

program
  .name('agentic-usability')
  .description('SDK Usability Benchmark CLI — measures how well AI agents can use an SDK')
  .version(pkg.version);

program
  .command('init')
  .description('Initialize a new .agentic-usability.json config file')
  .action(async () => {
    await initCommand();
  });

program
  .command('generate')
  .description('Generate test suite by having an AI agent explore the SDK source')
  .option('--fresh', 'Force re-resolve source (bypass cache)')
  .action(async (opts: { fresh?: boolean }) => {
    await generateCommand({ fresh: opts.fresh });
  });

program
  .command('execute')
  .description('Execute test cases in sandboxed environments with AI agents')
  .option('--fresh-docs', 'Bypass documentation cache')
  .action(async (opts: { freshDocs?: boolean }) => {
    await executeCommand({ freshDocs: opts.freshDocs });
  });

program
  .command('analyze')
  .description('Analyze generated solutions for expected SDK API calls and patterns')
  .action(async () => {
    await analyzeCommand();
  });

program
  .command('judge')
  .description('Have an LLM compare reference and generated solutions')
  .option('--skip-judge', 'Skip the judge stage')
  .action(async (opts: { skipJudge?: boolean }) => {
    await judgeCommand({ skipJudge: opts.skipJudge });
  });

program
  .command('report')
  .description('Display a terminal scorecard of benchmark results')
  .option('--json', 'Output raw structured JSON instead of the table')
  .action(async (opts: { json?: boolean }) => {
    await reportCommand({ json: opts.json });
  });

program
  .command('run')
  .description('Execute the full benchmark pipeline end-to-end')
  .option('--resume', 'Resume from last checkpoint')
  .option('--fresh', 'Clear existing pipeline state before starting')
  .option('--skip-judge', 'Skip the LLM judge stage')
  .action(async (opts: { resume?: boolean; fresh?: boolean; skipJudge?: boolean }) => {
    await runCommand({ resume: opts.resume, fresh: opts.fresh, skipJudge: opts.skipJudge });
  });

program
  .command('export')
  .description('Export the test suite to a file')
  .requiredOption('--output <path>', 'Output file path')
  .action(async (opts: { output: string }) => {
    await exportCommand({ output: opts.output });
  });

program
  .command('import')
  .description('Import a test suite from a file')
  .requiredOption('--input <path>', 'Input file path')
  .action(async (opts: { input: string }) => {
    await importCommand({ input: opts.input });
  });

program
  .command('edit')
  .description('Open the test suite in your editor for manual curation')
  .action(async () => {
    await editCommand();
  });

program
  .command('export-results')
  .description('Export all benchmark results to a single JSON file')
  .requiredOption('--output <path>', 'Output file path')
  .action(async (opts: { output: string }) => {
    await exportResultsCommand({ output: opts.output });
  });

program.parse();
