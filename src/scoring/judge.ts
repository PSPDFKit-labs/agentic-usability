import type { SolutionFile, JudgeScore, TestCase, AgentConfig } from '../core/types.js';
import { createAdapter } from '../agents/adapter.js';

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

1. **apiDiscovery** (0-100): Did the agent find and use the correct SDK endpoints/methods?
   - 0-20: Used completely wrong or unrelated APIs.
   - 21-40: Found some correct APIs but missed major ones.
   - 41-60: Found most APIs but used wrong alternatives for some.
   - 61-80: Found all major APIs, missed minor helper methods.
   - 81-100: Found exactly the right APIs matching the reference.

2. **callCorrectness** (0-100): Are the API calls constructed correctly (parameters, headers, body)?
   - 0-20: Wrong parameters, missing required fields, incorrect types.
   - 21-40: Some correct parameters but major issues (wrong field names, missing headers).
   - 41-60: Mostly correct but notable mistakes (wrong content type, incorrect body format).
   - 61-80: Correct parameters with minor issues (extra unnecessary fields, slightly different but valid options).
   - 81-100: Correct parameters, headers, request body, and call sequences.

3. **completeness** (0-100): Does the solution handle all requirements?
   - 0-20: Only addresses a fraction of the problem.
   - 21-40: Handles the main task but misses most secondary requirements.
   - 41-60: Covers the primary flow but skips error handling or edge cases.
   - 61-80: Handles most requirements including basic error paths.
   - 81-100: Fully complete — all requirements, edge cases, and error handling.

4. **functionalCorrectness** (0-100): Does the code actually run and produce correct output?
   - 0-20: Does not run — syntax errors, missing imports, crashes on start.
   - 21-40: Runs but produces mostly wrong output.
   - 41-60: Partially works — correct for some inputs, wrong for others.
   - 61-80: Works correctly for common cases, fails on edge cases.
   - 81-100: Runs correctly and produces expected output for all cases.

5. **overallVerdict** (boolean): Does the generated solution meet the core requirements? Set to true if it would pass acceptance tests, even if the implementation differs. Set to false if it fails to meet the core requirements.

6. **notes** (string): Brief explanation of your scoring. Mention which APIs were found/missed, any parameter issues, missing requirements, and functional problems.
${SCHEMA_DESCRIPTION}`;
}


function extractJsonObject(text: string): string {
  const fencedMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  const objStart = text.indexOf('{');
  const objEnd = text.lastIndexOf('}');
  if (objStart !== -1 && objEnd !== -1 && objEnd > objStart) {
    return text.slice(objStart, objEnd + 1);
  }

  return text.trim();
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
  const extracted = extractJsonObject(result.stdout);
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
