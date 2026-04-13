import chalk from 'chalk';
import ora from 'ora';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig, ensureWorkingDir } from '../core/config.js';
import { resolveSource } from '../core/source-resolver.js';
import { createAdapter } from '../agents/adapter.js';
import { TestCase, Config } from '../core/types.js';
import { printSuiteTable } from './suite-utils.js';

const DEFAULT_SUITE_FILE = '.agentic-usability/suite.json';

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
      targetApis: { type: 'array', items: { type: 'string' } },
      expectedTokens: { type: 'array', items: { type: 'string' } },
      tags: { type: 'array', items: { type: 'string' } },
      setupInstructions: { type: 'string' },
    },
    required: ['problemStatement', 'referenceSolution', 'difficulty', 'targetApis', 'expectedTokens', 'tags'],
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
    "targetApis": string[] (required),
    "expectedTokens": string[] (required),
    "tags": string[] (required),
    "setupInstructions": string (optional)
  }
]

No markdown fences, no explanation — just the raw JSON array.`;

function buildPrompt(sourcePath: string, config: Config): string {
  const packageName = config.publicInfo?.packageName ?? 'the SDK';
  const docsUrl = config.publicInfo?.docsUrl ?? '';

  return `You are a test case generator for an SDK usability benchmark.

Your task: Explore the codebase at "${sourcePath}" and generate a JSON array of programming test cases that evaluate an AI agent's ability to use ${packageName}.

${docsUrl ? `Documentation: ${docsUrl}` : ''}

Each test case must be a JSON object with these fields:
- "id" (string, optional): A unique ID like "TC-001". If omitted, one will be auto-assigned.
- "problemStatement" (string, required): A clear description of the programming task. This is what an AI agent will receive as instructions.
- "referenceSolution" (array of objects, required): Each object has "path" (string, file path) and "content" (string, file contents). This is the correct implementation.
- "difficulty" (string, required): One of "easy", "medium", or "hard".
- "targetApis" (array of strings, required): The SDK APIs that the solution should use (e.g., function names, class names, methods).
- "expectedTokens" (array of strings, required): Regex patterns or literal strings expected in the solution code (e.g., "import.*${packageName}").
- "tags" (array of strings, required): Categorization tags (e.g., "auth", "database", "http").
- "setupInstructions" (string, optional): Shell commands to run before the agent starts.

Guidelines:
- Generate a diverse set of test cases covering different difficulty levels and API surface areas.
- Each problem statement should be self-contained — the agent should be able to solve it with only the problem description and SDK documentation.
- Reference solutions should be correct, idiomatic usage of the SDK.
- Target APIs should be the specific SDK functions/classes the solution needs.
- Expected tokens should match patterns that indicate correct SDK usage.
${SCHEMA_DESCRIPTION}`;
}

function buildRetryPrompt(originalPrompt: string, error: string): string {
  return `${originalPrompt}

IMPORTANT: Your previous response was not valid JSON. The error was:
${error}

Please output ONLY a valid JSON array. No markdown code fences, no explanation text — just the raw JSON array starting with [ and ending with ].`;
}

function validateTestCase(tc: unknown, index: number): string[] {
  const errors: string[] = [];
  if (typeof tc !== 'object' || tc === null || Array.isArray(tc)) {
    return [`Test case at index ${index} is not an object`];
  }

  const obj = tc as Record<string, unknown>;

  if (typeof obj.problemStatement !== 'string' || obj.problemStatement.length === 0) {
    errors.push(`Test case ${index}: missing or empty problemStatement`);
  }

  if (!Array.isArray(obj.referenceSolution)) {
    errors.push(`Test case ${index}: referenceSolution must be an array`);
  } else {
    for (let i = 0; i < obj.referenceSolution.length; i++) {
      const sf = obj.referenceSolution[i] as Record<string, unknown>;
      if (typeof sf?.path !== 'string' || typeof sf?.content !== 'string') {
        errors.push(`Test case ${index}: referenceSolution[${i}] must have path and content strings`);
      }
    }
  }

  const validDifficulties = ['easy', 'medium', 'hard'];
  if (!validDifficulties.includes(obj.difficulty as string)) {
    errors.push(`Test case ${index}: difficulty must be one of ${validDifficulties.join(', ')}`);
  }

  if (!Array.isArray(obj.targetApis)) {
    errors.push(`Test case ${index}: targetApis must be an array`);
  }

  if (!Array.isArray(obj.expectedTokens)) {
    errors.push(`Test case ${index}: expectedTokens must be an array`);
  }

  if (!Array.isArray(obj.tags)) {
    errors.push(`Test case ${index}: tags must be an array`);
  }

  return errors;
}

function extractJson(text: string): string {
  const fencedMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  const arrayStart = text.indexOf('[');
  const arrayEnd = text.lastIndexOf(']');
  if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
    return text.slice(arrayStart, arrayEnd + 1);
  }

  return text.trim();
}

function parseGenerateOutput(stdout: string, supportsSchema: boolean): { parsed: unknown } | { error: string } {
  if (supportsSchema) {
    try {
      return { parsed: JSON.parse(stdout) };
    } catch (err) {
      const extracted = extractJson(stdout);
      try {
        return { parsed: JSON.parse(extracted) };
      } catch {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }
  }

  const extracted = extractJson(stdout);
  try {
    return { parsed: JSON.parse(extracted) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function assignIds(testCases: TestCase[]): void {
  for (let i = 0; i < testCases.length; i++) {
    if (!testCases[i].id || testCases[i].id.trim() === '') {
      testCases[i].id = `TC-${String(i + 1).padStart(3, '0')}`;
    }
  }
}

function printSummary(testCases: TestCase[]): void {
  console.log(chalk.green(`\nGenerated ${testCases.length} test case(s)\n`));

  const byDifficulty = { easy: 0, medium: 0, hard: 0 };
  const allApis = new Set<string>();

  for (const tc of testCases) {
    byDifficulty[tc.difficulty]++;
    for (const api of tc.targetApis) {
      allApis.add(api);
    }
  }

  console.log(chalk.bold('Difficulty breakdown:'));
  console.log(`  Easy:   ${byDifficulty.easy}`);
  console.log(`  Medium: ${byDifficulty.medium}`);
  console.log(`  Hard:   ${byDifficulty.hard}`);

  console.log(chalk.bold(`\nTarget APIs found: ${allApis.size}`));
  if (allApis.size > 0) {
    for (const api of allApis) {
      console.log(`  - ${api}`);
    }
  }
}

export async function generateCommand(options: { fresh?: boolean } = {}): Promise<void> {
  const config = await loadConfig();
  await ensureWorkingDir();

  const spinner = ora('Resolving source...').start();
  const sourcePath = await resolveSource(config, { fresh: options.fresh });
  spinner.succeed(`Source resolved: ${sourcePath}`);

  const generatorConfig = config.agents?.generator ?? { command: 'claude' };
  const adapter = createAdapter(generatorConfig);

  const prompt = buildPrompt(sourcePath, config);

  spinner.start(`Running generator agent (${adapter.name})...`);
  let result = await adapter.executeWithSchema(prompt, TEST_SUITE_SCHEMA, sourcePath);
  spinner.succeed(`Agent finished (${result.durationMs}ms, exit code ${result.exitCode})`);

  let parseResult = parseGenerateOutput(result.stdout, adapter.supportsSchema);

  // Retry for non-schema agents on parse failure
  if ('error' in parseResult && !adapter.supportsSchema) {
    console.log(chalk.yellow(`First attempt produced malformed JSON: ${parseResult.error}`));
    console.log(chalk.yellow('Retrying with correction prompt...'));

    const retryPrompt = buildRetryPrompt(prompt, parseResult.error);
    spinner.start(`Retrying generator agent (${adapter.name})...`);
    result = await adapter.executeWithSchema(retryPrompt, TEST_SUITE_SCHEMA, sourcePath);
    spinner.succeed(`Retry finished (${result.durationMs}ms, exit code ${result.exitCode})`);

    parseResult = parseGenerateOutput(result.stdout, adapter.supportsSchema);
  }

  if ('error' in parseResult) {
    throw new Error(`Agent output is not valid JSON: ${parseResult.error}`);
  }

  const parsed = parseResult.parsed;

  if (!Array.isArray(parsed)) {
    throw new Error('Agent output is not a JSON array of test cases');
  }

  // Validate each test case
  const allErrors: string[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const errors = validateTestCase(parsed[i], i);
    allErrors.push(...errors);
  }

  if (allErrors.length > 0) {
    throw new Error(`Test suite validation failed:\n${allErrors.join('\n')}`);
  }

  const testCases = parsed as TestCase[];
  assignIds(testCases);

  // Save suite
  const suiteFile = resolve(config.output?.suiteFile ?? DEFAULT_SUITE_FILE);
  await writeFile(suiteFile, JSON.stringify(testCases, null, 2), 'utf-8');
  console.log(chalk.green(`\nSuite saved to ${suiteFile}`));

  printSummary(testCases);
  printSuiteTable(testCases);
}
