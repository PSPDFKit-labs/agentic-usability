import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../core/config.js';
import { resolveSources, getUrlSources } from '../core/source-resolver.js';
import { loadTestSuite } from '../core/suite-io.js';
import { createAdapter } from '../agents/adapter.js';
import type { AggregateResults, ProjectPaths, Config } from '../types.js';
import { loadAllResults, computeAggregates } from '../core/results.js';
import { buildSourceList, buildUrlSourceList, DIFFICULTY_RUBRIC, JUDGE_SCORING_CRITERIA } from './prompt-helpers.js';
import { startUrlProxy, rewriteConfigUrlsForProxy } from '../proxy/url-proxy.js';

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function buildAggregateSection(agg: AggregateResults): string {
  const lines: string[] = [
    `### Target: ${agg.target}`,
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| API Discovery | ${formatPercent(agg.avgApiDiscovery)} |`,
    `| Call Correctness | ${formatPercent(agg.avgCallCorrectness)} |`,
    `| Completeness | ${formatPercent(agg.avgCompleteness)} |`,
    `| Functional Correctness | ${formatPercent(agg.avgFunctionalCorrectness)} |`,
    `| Pass Rate | ${formatPercent(agg.passRate)} |`,
  ];

  if (Object.keys(agg.byDifficulty).length > 0) {
    lines.push('', '**By Difficulty:**');
    for (const [difficulty, stats] of Object.entries(agg.byDifficulty)) {
      lines.push(`- ${difficulty} (${stats.count} tests): Discovery ${formatPercent(stats.avgApiDiscovery)}, Correctness ${formatPercent(stats.avgCallCorrectness)}, Pass Rate ${formatPercent(stats.passRate)}`);
    }
  }

  return lines.join('\n');
}

function buildTestResultsSection(agg: AggregateResults): string {
  const lines: string[] = [];

  for (const r of agg.testResults) {
    const stmt = r.problemStatement.length > 200
      ? r.problemStatement.slice(0, 200) + '...'
      : r.problemStatement;

    const parts = [`#### ${r.testId} (${r.difficulty})`];
    parts.push(`**Problem:** ${stmt}`);

    if (r.judgeScore) {
      parts.push(`**Judge Scores:** Discovery ${r.judgeScore.apiDiscovery}, Correctness ${r.judgeScore.callCorrectness}, Completeness ${r.judgeScore.completeness}, Functional ${r.judgeScore.functionalCorrectness} → ${r.judgeScore.overallVerdict ? 'PASS' : 'FAIL'}`);
      if (r.judgeScore.notes) {
        parts.push(`**Judge Notes:** ${r.judgeScore.notes}`);
      }
    }

    if (r.agentNotes) {
      const notes = r.agentNotes.length > 500
        ? r.agentNotes.slice(0, 500) + '...'
        : r.agentNotes;
      parts.push(`**Agent Notes:** ${notes}`);
    }

    if (!r.judgeScore) {
      parts.push('**Status:** No results available');
    }

    lines.push(parts.join('\n'));
  }

  return lines.join('\n\n');
}

function buildFilePathsSection(paths: ProjectPaths, allAggregates: AggregateResults[]): string {
  const targets = allAggregates.map(a => a.target);
  const testIds = [...new Set(allAggregates.flatMap(a => a.testResults.map(r => r.testId)))];

  return `The full test suite (with reference solutions) is at: ${paths.suite}

Results base directory: ${paths.results}

Results are organized as: {resultsDir}/{target}/{testId}/

Run-level files (in resultsDir):
  run.json                     — run metadata (id, label, targets, testCount)
  pipeline-state.json          — resume checkpoint
  report.json                  — scorecard export

Per-test-case files (in {resultsDir}/{target}/{testId}/):
  generated-solution.json      — agent's generated solution
  workspace-snapshot.tar.gz    — sandbox state for judge reconstruction
  setup.log                    — workspace scaffolding log
  install-error.log            — agent CLI install failure (only on error)
  agent-cmd.log                — agent command that was executed
  agent-output.log             — raw agent stdout/stderr
  agent-notes.md               — agent's self-reported working notes
  agent-proxy.log.json         — executor proxy request logs
  agent-error.log              — execution error (only on error)
  judge.json                   — full judge assessment
  judge-cmd.log                — judge command that was executed
  judge-output.log             — raw judge stdout/stderr
  judge-proxy.log.json         — judge proxy request logs
  judge-error.log              — judge error (only on error)

Targets in this run: ${targets.join(', ')}
Test IDs: ${testIds.join(', ')}`;
}

export function buildInsightsPrompt(
  sourcePaths: string[],
  config: Config,
  allAggregates: AggregateResults[],
  paths: ProjectPaths,
): string {
  const packageName = config.publicInfo?.packageName ?? 'the SDK';

  const sections: string[] = [];

  // 1. Role
  sections.push(`You are an SDK usability analyst. You have access to the full results of an automated benchmark that tested how well AI coding agents can use ${packageName}. Your job is to help the developer understand where the SDK is lacking and what improvements would have the biggest impact on agent usability.`);

  // 2. Source locations
  const urlSection = buildUrlSourceList(getUrlSources(config));
  sections.push(`## SDK Source Locations\n\nThe SDK source code that was used to generate test cases:\n${buildSourceList(sourcePaths, config)}${urlSection}`);

  // 3. How the benchmark works
  sections.push(`## How the Benchmark Works

1. **Generate**: An AI agent explores the SDK source code and generates programming test cases.
2. **Execute**: For each test case, a separate AI agent is placed in a sandboxed Docker container with only the problem statement and public SDK documentation. It must write a solution using the SDK.
3. **Judge**: An LLM compares the reference solution to the generated solution and scores it on multiple dimensions.

### Test Case Structure

Each test case has these fields:
- **problemStatement**: A clear description of the programming task. This is what the AI agent receives as instructions.
- **referenceSolution**: Array of files (path + content) representing the correct implementation.
- **difficulty**: One of "easy", "medium", or "hard":
${DIFFICULTY_RUBRIC}
- **tags**: Categorization tags (e.g., "auth", "database", "http").

### Judge Scoring Criteria

The LLM judge scores each generated solution against the reference on these criteria:

${JUDGE_SCORING_CRITERIA}`);

  // 4. Aggregate results
  for (const agg of allAggregates) {
    sections.push(`## Results\n\n${buildAggregateSection(agg)}`);
  }

  // 5. Per-test-case results
  for (const agg of allAggregates) {
    sections.push(`## Per-Test-Case Results (${agg.target})\n\n${buildTestResultsSection(agg)}`);
  }

  // 6. File paths for deep dives
  sections.push(`## File Paths for Deep Dives\n\n${buildFilePathsSection(paths, allAggregates)}\n\nYou can read any of these files to get detailed information about specific test cases.`);

  // 7. Instructions
  sections.push(`## Your Task

Analyze these benchmark results and help the developer understand:

1. **Failure Patterns**: Which APIs are hardest for agents to discover or use correctly? Are there common mistakes across multiple test cases?
2. **SDK Documentation Gaps**: Where is the documentation insufficient? Which APIs lack clear examples or have confusing signatures?
3. **API Design Issues**: Are there naming conventions, parameter patterns, or workflows that trip up agents? Would renaming, simplifying, or adding convenience methods help?
4. **Prioritized Recommendations**: Which specific improvements would fix the most failures? Rank them by impact.
5. **Deep Dives**: Read the SDK source code, reference solutions, and generated solutions to understand the root causes of failures.
6. **Agent Self-Reports**: The executing agent was asked to keep a notes.md log. Where available, these contain first-person accounts of confusion, failed attempts, and gotchas. Use them to understand the agent's experience with the SDK.

Start by giving an overview of the key findings, then let the developer guide the conversation into specific areas of interest.`);

  return sections.join('\n\n');
}

export async function insightsCommand(paths: ProjectPaths, options: { fresh?: boolean } = {}): Promise<void> {
  const loadedConfig = await loadConfig(paths.config);
  const urlProxy = await startUrlProxy(loadedConfig, paths.root, 'host.docker.internal');
  const config = urlProxy
    ? rewriteConfigUrlsForProxy(loadedConfig, urlProxy.localBaseUrl)
    : loadedConfig;

  if (urlProxy) {
    console.log(chalk.dim(`URL access log: ${urlProxy.accessLogPath}`));
  }

  try {
    const spinner = ora('Resolving sources...').start();
    const sourcePaths = await resolveSources(config, { fresh: options.fresh, reposDir: paths.cacheRepos });
    spinner.succeed(`Sources resolved: ${sourcePaths.join(', ')}`);

    const loadSpinner = ora('Loading test suite and results...').start();
    const testCases = await loadTestSuite(paths);

    const allAggregates: AggregateResults[] = [];
    for (const target of config.targets) {
      const testResults = await loadAllResults(paths, testCases, target.name);
      const aggregates = computeAggregates(testResults, target.name);
      allAggregates.push(aggregates);
    }
    loadSpinner.succeed(`Loaded ${testCases.length} test case(s) across ${config.targets.length} target(s)`);

    const totalResults = allAggregates.reduce((sum, agg) => sum + agg.testResults.filter(r => r.judgeScore).length, 0);
    if (totalResults === 0) {
      console.log(chalk.yellow('\nNo results found. Run the pipeline first: agentic-usability eval'));
      return;
    }

    const prompt = buildInsightsPrompt(sourcePaths, config, allAggregates, paths);

    const adapterConfig = config.agents?.insights ?? { command: 'claude' };
    const adapter = createAdapter(adapterConfig);

    console.log(chalk.bold(`\nLaunching interactive ${adapter.name} session for SDK insights...`));
    console.log(chalk.dim(`The agent has been pre-loaded with all benchmark results.`));
    console.log(chalk.dim(`Ask about failure patterns, API design issues, documentation gaps, and improvement priorities.\n`));

    const { exitCode, durationMs } = await adapter.interactive(prompt, paths.root);

    console.log(chalk.dim(`\nAgent exited (code ${exitCode}, ${Math.round(durationMs / 1000)}s)`));
  } finally {
    await urlProxy?.stop();
  }
}
