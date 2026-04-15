import type { SolutionFile, JudgeScore, TestCase, AgentConfig } from '../core/types.js';
import { createAdapter } from '../agents/adapter.js';
import { JUDGE_SCORING_CRITERIA, extractJson } from '../commands/prompt-helpers.js';

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    apiDiscovery: { type: 'number', minimum: 0, maximum: 100 },
    callCorrectness: { type: 'number', minimum: 0, maximum: 100 },
    completeness: { type: 'number', minimum: 0, maximum: 100 },
    functionalCorrectness: { type: 'number', minimum: 0, maximum: 100 },
    overallVerdict: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: ['apiDiscovery', 'callCorrectness', 'completeness', 'functionalCorrectness', 'overallVerdict', 'notes'],
  additionalProperties: false,
};

const SCHEMA_DESCRIPTION = `
Output ONLY a valid JSON object matching this schema:
{
  "apiDiscovery": number (0-100),
  "callCorrectness": number (0-100),
  "completeness": number (0-100),
  "functionalCorrectness": number (0-100),
  "overallVerdict": boolean,
  "notes": string
}

No markdown fences, no explanation — just the raw JSON object.`;

export function formatSolution(files: SolutionFile[]): string {
  return files
    .map((f) => `--- File: ${f.path} ---\n${f.content}`)
    .join('\n\n');
}

function buildJudgePrompt(testCase: TestCase, referenceSolution: string, generatedSolution: string): string {
  return `You are an expert code reviewer judging an AI-generated solution's use of an SDK/API compared to a reference solution.

IMPORTANT: Focus your evaluation on SDK/API usage. Ignore cosmetic differences in:
- Variable naming and code formatting
- Comment style or absence of comments
- Import ordering or module organization
- Output formatting (print vs logging style)

## Problem Statement
${testCase.problemStatement}

## Reference Solution
${referenceSolution}

## Generated Solution
${generatedSolution}

## Your Task
Compare the generated solution to the reference solution and score it on the following criteria:

${JUDGE_SCORING_CRITERIA}
${SCHEMA_DESCRIPTION}`;
}



function validateJudgeScore(obj: unknown): string[] {
  const errors: string[] = [];
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return ['Judge output is not a JSON object'];
  }

  const score = obj as Record<string, unknown>;

  for (const field of ['apiDiscovery', 'callCorrectness', 'completeness', 'functionalCorrectness']) {
    if (typeof score[field] !== 'number' || score[field] < 0 || score[field] > 100) {
      errors.push(`${field} must be a number between 0 and 100`);
    }
  }

  if (typeof score.overallVerdict !== 'boolean') {
    errors.push('overallVerdict must be a boolean');
  }

  if (typeof score.notes !== 'string') {
    errors.push('notes must be a string');
  }

  return errors;
}

export async function runJudge(
  testCase: TestCase,
  generatedSolution: SolutionFile[],
  judgeConfig: AgentConfig,
  target: string,
): Promise<JudgeScore> {
  const adapter = createAdapter(judgeConfig);

  const referenceSolutionText = formatSolution(testCase.referenceSolution);
  const generatedSolutionText = formatSolution(generatedSolution);

  const prompt = buildJudgePrompt(testCase, referenceSolutionText, generatedSolutionText);

  // adapter.run() handles envelope unwrapping and retry internally
  const result = await adapter.run(prompt, JUDGE_SCHEMA, process.cwd());

  // Parse the clean stdout — try direct parse, then extract JSON object from text
  const extracted = extractJson(result.stdout, 'object');
  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted);
  } catch (err) {
    throw new Error(`Judge output is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  const validationErrors = validateJudgeScore(parsed);
  if (validationErrors.length > 0) {
    throw new Error(`Judge output validation failed:\n${validationErrors.join('\n')}`);
  }

  const score = parsed as Record<string, unknown>;

  return {
    testId: testCase.id,
    target,
    apiDiscovery: score.apiDiscovery as number,
    callCorrectness: score.callCorrectness as number,
    completeness: score.completeness as number,
    functionalCorrectness: score.functionalCorrectness as number,
    overallVerdict: score.overallVerdict as boolean,
    notes: score.notes as string,
  };
}
