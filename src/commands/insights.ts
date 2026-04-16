import chalk from 'chalk';
import ora from 'ora';
import { join } from 'node:path';
import { loadConfig } from '../core/config.js';
import { resolveSources } from '../core/source-resolver.js';
import { loadTestSuite } from '../core/suite-io.js';
import { createAdapter } from '../agents/adapter.js';
import { type AggregateResults, loadAllResults, computeAggregates } from '../core/results.js';
import type { Config } from '../core/types.js';
import type { ProjectPaths } from '../core/paths.js';
import { buildSourceList, DIFFICULTY_RUBRIC, JUDGE_SCORING_CRITERIA } from './prompt-helpers.js';

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function buildAggregateSection(agg: AggregateResults): string {
  const lines: string[] = [
    `### Target: ${agg.target}`,
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| API Coverage | ${formatPercent(agg.avgApiCoverage)} |`,
    `| Token Coverage | ${formatPercent(agg.avgTokenCoverage)} |`,
    `| API Discovery (judge) | ${formatPercent(agg.avgApiDiscovery)} |`,
    `| Call Correctness (judge) | ${formatPercent(agg.avgCallCorrectness)} |`,
    `| Completeness (judge) | ${formatPercent(agg.avgCompleteness)} |`,
    `| Functional Correctness (judge) | ${formatPercent(agg.avgFunctionalCorrectness)} |`,
    `| Pass Rate | ${formatPercent(agg.passRate)} |`,
  ];

  if (Object.keys(agg.byDifficulty).length > 0) {
    lines.push('', '**By Difficulty:**');
    for (const [difficulty, stats] of Object.entries(agg.byDifficulty)) {
      lines.push(`- ${difficulty} (${stats.count} tests): API Cov ${formatPercent(stats.avgApiCoverage)}, Token Cov ${formatPercent(stats.avgTokenCoverage)}, Pass Rate ${formatPercent(stats.passRate)}`);
    }
  }

  if (agg.worstApis.length > 0) {
    lines.push('', '**Worst Performing APIs (agents failed to use these):**');
    for (const api of agg.worstApis) {
      lines.push(`- ${api.api}: missed ${api.missCount}/${api.totalCount} times (${formatPercent(api.missRate)} miss rate)`);
    }
  }

  if (agg.missedTokens.length > 0) {
    lines.push('', '**Missed Expected Tokens:**');
    for (const t of agg.missedTokens) {
      lines.push(`- \`${t.token}\`: missed ${t.missCount}/${t.totalCount} times (${formatPercent(t.missRate)} miss rate)`);
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

    if (r.tokenAnalysis) {
      parts.push(`**Token Analysis:** API Coverage ${formatPercent(r.tokenAnalysis.apiCoverage)}, Token Coverage ${formatPercent(r.tokenAnalysis.tokenCoverage)}`);
    }

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

    if (!r.tokenAnalysis && !r.judgeScore) {
      parts.push('**Status:** No results available');
    }

    lines.push(parts.join('\n'));
  }

  return lines.join('\n\n');
}

function buildFilePathsSection(paths: ProjectPaths, allAggregates: AggregateResults[]): string {
  const lines: string[] = [
    `The full test suite (with reference solutions) is at: ${paths.suite}`,
    '',
    'Per-test-case result files are at:',
  ];

  for (const agg of allAggregates) {
    for (const r of agg.testResults) {
      const dir = join(paths.results, agg.target, r.testId);
      lines.push(`- ${dir}/generated-solution.json — agent's generated solution`);
      lines.push(`- ${dir}/agent-notes.md — agent's self-reported progress and gotchas`);
      lines.push(`- ${dir}/token-analysis.json — detailed token match results`);
      lines.push(`- ${dir}/judge.json — full judge assessment`);
    }
  }

  return lines.join('\n');
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
  sections.push(`## SDK Source Locations\n\nThe SDK source code that was used to generate test cases:\n${buildSourceList(sourcePaths, config)}`);

  // 3. How the benchmark works
  sections.push(`## How the Benchmark Works

1. **Generate**: An AI agent explores the SDK source code and generates programming test cases.
2. **Execute**: For each test case, a separate AI agent is placed in a sandboxed Docker container with only the problem statement and public SDK documentation. It must write a solution using the SDK.
3. **Analyze**: The generated solution is checked against expected patterns using deterministic regex-based token analysis.
4. **Judge**: An LLM compares the reference solution to the generated solution and scores it on multiple dimensions.

### Test Case Structure

Each test case has these fields:
- **problemStatement**: A clear description of the programming task. This is what the AI agent receives as instructions.
- **referenceSolution**: Array of files (path + content) representing the correct implementation.
- **difficulty**: One of "easy", "medium", or "hard":
${DIFFICULTY_RUBRIC}
- **targetApis**: The SDK APIs that the solution should use (e.g., function names, class names, methods).
- **expectedTokens**: Regex patterns or literal strings expected in the solution code.
- **tags**: Categorization tags (e.g., "auth", "database", "http").

### Token Analysis Scoring

- **API Coverage**: Word-boundary match for each entry in targetApis against the generated solution files. REST-style APIs (e.g., "POST /build") are automatically decomposed into separate HTTP method + URL path checks.
- **Token Coverage**: Full regex match (with dotAll/multiline support) for each entry in expectedTokens. Invalid regex falls back to escaped literal match.

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
  const config = await loadConfig(paths.config);

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

  const totalResults = allAggregates.reduce((sum, agg) => sum + agg.testResults.filter(r => r.tokenAnalysis || r.judgeScore).length, 0);
  if (totalResults === 0) {
    console.log(chalk.yellow('\nNo results found. Run the pipeline first: agentic-usability run'));
    return;
  }

  const prompt = buildInsightsPrompt(sourcePaths, config, allAggregates, paths);

  const adapterConfig = config.agents?.generator ?? { command: 'claude' };
  const adapter = createAdapter(adapterConfig);

  console.log(chalk.bold(`\nLaunching interactive ${adapter.name} session for SDK insights...`));
  console.log(chalk.dim(`The agent has been pre-loaded with all benchmark results.`));
  console.log(chalk.dim(`Ask about failure patterns, API design issues, documentation gaps, and improvement priorities.\n`));

  const { exitCode, durationMs } = await adapter.interactive(prompt, paths.root);

  console.log(chalk.dim(`\nAgent exited (code ${exitCode}, ${Math.round(durationMs / 1000)}s)`));
}
