import chalk from 'chalk';
import ora from 'ora';
import { readFile, writeFile } from 'node:fs/promises';
import { loadConfig } from '../core/config.js';
import { resolveSources, getUrlSources } from '../core/source-resolver.js';
import { createAdapter, type AgentAdapter } from '../agents/adapter.js';
import type { TestCase, Config, ProjectPaths } from '../types.js';
import { printSuiteTable, validateTestCase } from './suite-utils.js';
import { buildSourceList, buildUrlSourceList, DIFFICULTY_RUBRIC, extractJson } from './prompt-helpers.js';

const TEST_SUITE_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      problemStatement: { type: 'string' },
      referenceSolution: {
        type: 'array',
        items: {
          type: 'object',
          properties: { path: { type: 'string' }, content: { type: 'string' } },
          required: ['path', 'content'],
        },
      },
      difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
      tags: { type: 'array', items: { type: 'string' } },
      setupInstructions: { type: 'string' },
    },
    required: ['problemStatement', 'referenceSolution', 'difficulty', 'tags'],
  },
};

const SCHEMA_DESCRIPTION = `
Output ONLY a valid JSON array of test case objects matching this schema:
[
  {
    "id": string (optional, e.g. "TC-001"),
    "problemStatement": string (required),
    "referenceSolution": [{ "path": string, "content": string }] (required),
    "difficulty": "easy" | "medium" | "hard" (required),
    "tags": string[] (required),
    "setupInstructions": string (optional)
  }
]

No markdown fences, no explanation — just the raw JSON array.`;

function summarizeExistingTests(testCases: TestCase[]): string {
  if (testCases.length === 0) return '';

  const lines = testCases.map((tc) => {
    return `- ${tc.id} (${tc.difficulty}): ${tc.problemStatement.slice(0, 100)}${tc.problemStatement.length > 100 ? '...' : ''}`;
  });

  return `\n## Existing Test Cases (DO NOT DUPLICATE)\nThe suite already contains ${testCases.length} test case(s). Do NOT generate test cases that overlap with these:\n${lines.join('\n')}\n\nGenerate new, complementary test cases that cover different APIs and scenarios.\n`;
}

function buildSourceSection(sourcePaths: string[], config: Config): string {
  const fileSources = sourcePaths.length > 0
    ? `Your task: Explore the following source(s):\n${buildSourceList(sourcePaths, config).replace(/^- /gm, '  - ')}`
    : '';
  const urlSection = buildUrlSourceList(getUrlSources(config));
  return `${fileSources}${urlSection}\n\nUse all of them`;
}

function buildPrompt(sourcePaths: string[], config: Config, existingTests: TestCase[] = []): string {
  const packageName = config.publicInfo?.packageName ?? 'the SDK';
  const docsUrl = config.publicInfo?.docsUrl ?? '';

  return `You are a test case generator for an SDK usability benchmark.

${buildSourceSection(sourcePaths, config)} and generate a JSON array of programming test cases that evaluate an AI agent's ability to use ${packageName}.

${docsUrl ? `Documentation: ${docsUrl}` : ''}
${summarizeExistingTests(existingTests)}
Each test case must be a JSON object with these fields:
- "id" (string, optional): A unique ID like "TC-001". If omitted, one will be auto-assigned.
- "problemStatement" (string, required): A goal-oriented description of the task in domain terms. Do NOT include API endpoint paths, function names, parameter names, or request/response structures — the agent must discover those itself. This is what an AI agent will receive as its only instructions.
- "referenceSolution" (array of objects, required): Each object has "path" (string, file path) and "content" (string, file contents). This is the correct implementation.
- "difficulty" (string, required): One of "easy", "medium", or "hard":
${DIFFICULTY_RUBRIC}
- "tags" (array of strings, required): Categorization tags (e.g., "auth", "database", "http").
- "setupInstructions" (string, optional): Shell commands to run before the agent starts.

Guidelines:
- Generate a diverse set of test cases covering different difficulty levels and API surface areas.
- Each problem statement should be self-contained — the agent should be able to solve it with only the problem description and SDK documentation.
- Reference solutions should be correct, idiomatic usage of the SDK.
- IMPORTANT: Problem statements must describe the GOAL in domain/product terms, not prescribe the implementation. Write them as if from a developer who knows what the product does but has not read the API reference. For example:
  BAD:  "Use POST /processor/convert_to_pdf with multipart/form-data containing a field named 'file'"
  GOOD: "Convert a .docx file to PDF using the document processing API and save the result locally"
  BAD:  "Call client.messages.create with model='claude-sonnet-4-6' and max_tokens=1024"
  GOOD: "Send a text prompt to the Claude API and print the response"
  The problem statement should mention WHAT to accomplish, not HOW (no endpoint paths, parameter names, JSON field names, or request body structures). The agent's job is to discover the right API calls from the SDK sources and documentation — if the problem statement spells them out, you're testing copy-paste, not API discovery.
- When multiple valid API approaches exist (e.g. different library versions, REST vs SDK wrapper), create separate test cases for each approach. Disambiguate by describing the goal differently (e.g. "using the REST API directly" vs "using the Python SDK client"), NOT by naming specific functions or endpoints.
${config.publicInfo?.language ? `\nIMPORTANT: All test cases and reference solutions MUST use ${config.publicInfo.language}.\n` : ''}${buildTargetContext(config)}${SCHEMA_DESCRIPTION}`;
}


function buildTargetContext(config: Config): string {
  const lines: string[] = [];
  for (const target of config.targets) {
    if (target.additionalContext) {
      lines.push(`- ${target.name} (${target.image}): ${target.additionalContext}`);
    }
  }
  if (lines.length === 0) return '';
  return `\nTarget environment notes (use these when writing setupInstructions):\n${lines.join('\n')}\n`;
}


function assignIds(testCases: TestCase[]): void {
  const existingIds = new Set(testCases.filter((tc) => tc.id && tc.id.trim() !== '').map((tc) => tc.id));
  let nextNum = 0;

  for (let i = 0; i < testCases.length; i++) {
    if (!testCases[i].id || testCases[i].id.trim() === '') {
      let candidate: string;
      do {
        nextNum++;
        candidate = `TC-${String(nextNum).padStart(3, '0')}`;
      } while (existingIds.has(candidate));
      testCases[i].id = candidate;
      existingIds.add(candidate);
    }
  }
}

function printSummary(testCases: TestCase[]): void {
  console.log(chalk.green(`\nGenerated ${testCases.length} test case(s)\n`));

  const byDifficulty = { easy: 0, medium: 0, hard: 0 };

  for (const tc of testCases) {
    byDifficulty[tc.difficulty]++;
  }

  console.log(chalk.bold('Difficulty breakdown:'));
  console.log(`  Easy:   ${byDifficulty.easy}`);
  console.log(`  Medium: ${byDifficulty.medium}`);
  console.log(`  Hard:   ${byDifficulty.hard}`);

}

export async function generateCommand(paths: ProjectPaths, options: { fresh?: boolean; nonInteractive?: boolean } = {}): Promise<void> {
  const config = await loadConfig(paths.config);

  const spinner = ora('Resolving sources...').start();
  const sourcePaths = await resolveSources(config, { fresh: options.fresh, reposDir: paths.cacheRepos });
  spinner.succeed(`Sources resolved: ${sourcePaths.join(', ')}`);

  const generatorConfig = config.agents?.generator ?? { command: 'claude' };
  const adapter = createAdapter(generatorConfig);
  const suiteFile = paths.suite;

  // Load existing tests to avoid duplicates
  let existingTests: TestCase[] = [];
  if (!options.fresh) {
    try {
      const raw = await readFile(suiteFile, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        existingTests = parsed as TestCase[];
      }
    } catch {
      // No existing suite — that's fine
    }
  }

  if (existingTests.length > 0) {
    console.log(chalk.dim(`Found ${existingTests.length} existing test case(s) — agent will avoid duplicates.`));
  }

  const prompt = buildPrompt(sourcePaths, config, existingTests)
    + `\n\nWhen you are done, write the final JSON array to: ${suiteFile}`;

  // Always use the project root as cwd. The prompt already contains the full source path,
  // so the agent can navigate to it regardless. This avoids ENOTDIR when the source is a
  // single file, and keeps behavior consistent across local/git/url source types.
  const workDir = paths.root;

  if (options.nonInteractive) {
    // Non-interactive mode: use adapter with piped stdio (for CI or automation)
    return generateNonInteractive(adapter, prompt, workDir, suiteFile, existingTests);
  }

  // Interactive mode: launch the agent with inherited stdio so the user can collaborate
  console.log(chalk.bold(`\nLaunching interactive ${adapter.name} session...`));
  console.log(chalk.dim(`The agent will explore ${sourcePaths.join(', ')} and generate test cases.`));
  console.log(chalk.dim(`You can give feedback, ask for changes, and guide the generation.`));
  console.log(chalk.dim(`The agent will write the suite to ${suiteFile} when done.\n`));

  const { exitCode, durationMs } = await adapter.interactive(prompt, workDir);

  console.log(chalk.dim(`\nAgent exited (code ${exitCode}, ${Math.round(durationMs / 1000)}s)`));

  // Validate the suite file the agent wrote
  await validateAndFinalize(suiteFile);
}

async function generateNonInteractive(
  adapter: AgentAdapter,
  prompt: string,
  workDir: string,
  suiteFile: string,
  existingTests: TestCase[] = [],
): Promise<void> {
  const spinner = ora(`Running generator agent (${adapter.name})...`).start();

  // adapter.run() handles envelope unwrapping and retry internally
  const result = await adapter.run(prompt, TEST_SUITE_SCHEMA, workDir);
  spinner.succeed(`Agent finished (${result.durationMs}ms, exit code ${result.exitCode})`);

  // Parse the clean stdout from the adapter
  const extracted = extractJson(result.stdout);
  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted);
  } catch (err) {
    throw new Error(`Agent output is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Agent output is not a JSON array of test cases');
  }

  // Validate each test case
  const allErrors: string[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const errors = validateTestCase(parsed[i], i, { requireId: false });
    allErrors.push(...errors);
  }

  if (allErrors.length > 0) {
    throw new Error(`Test suite validation failed:\n${allErrors.join('\n')}`);
  }

  const newTests = parsed as TestCase[];
  const merged = [...existingTests, ...newTests];
  assignIds(merged);

  await writeFile(suiteFile, JSON.stringify(merged, null, 2), 'utf-8');
  console.log(chalk.green(`\nSuite saved to ${suiteFile} (${existingTests.length} existing + ${newTests.length} new = ${merged.length} total)`));

  printSummary(merged);
  printSuiteTable(merged);
}

async function validateAndFinalize(suiteFile: string): Promise<void> {
  // Read and validate the suite file the agent wrote
  let raw: string;
  try {
    raw = await readFile(suiteFile, 'utf-8');
  } catch {
    throw new Error(
      `Suite file not found at ${suiteFile}.\nThe agent may not have written the file. Try running again or use --non-interactive.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Suite file at ${suiteFile} is not valid JSON. Please fix it manually or regenerate.`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Suite file at ${suiteFile} is not a JSON array.`);
  }

  const allErrors: string[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const errors = validateTestCase(parsed[i], i, { requireId: false });
    allErrors.push(...errors);
  }

  if (allErrors.length > 0) {
    throw new Error(`Test suite validation failed:\n${allErrors.join('\n')}`);
  }

  const testCases = parsed as TestCase[];
  assignIds(testCases);

  // Re-write with assigned IDs and consistent formatting
  await writeFile(suiteFile, JSON.stringify(testCases, null, 2), 'utf-8');

  console.log(chalk.green(`\nSuite validated and saved to ${suiteFile}`));
  printSummary(testCases);
  printSuiteTable(testCases);
}
