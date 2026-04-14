import type { SolutionFile, JudgeScore, TestCase, AgentConfig } from '../core/types.js';
import { createAdapter } from '../agents/adapter.js';

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    functionalEquivalence: { type: 'number', minimum: 0, maximum: 100 },
    apiCorrectness: { type: 'number', minimum: 0, maximum: 100 },
    idiomaticUsage: { type: 'number', minimum: 0, maximum: 100 },
    overallSimilarity: { type: 'number', minimum: 0, maximum: 100 },
    functionalMatch: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: ['functionalEquivalence', 'apiCorrectness', 'idiomaticUsage', 'overallSimilarity', 'functionalMatch', 'notes'],
  additionalProperties: false,
};

const SCHEMA_DESCRIPTION = `
Output ONLY a valid JSON object matching this schema:
{
  "functionalEquivalence": number (0-100),
  "apiCorrectness": number (0-100),
  "idiomaticUsage": number (0-100),
  "overallSimilarity": number (0-100),
  "functionalMatch": boolean,
  "notes": string
}

No markdown fences, no explanation — just the raw JSON object.`;

export function formatSolution(files: SolutionFile[]): string {
  return files
    .map((f) => `--- File: ${f.path} ---\n${f.content}`)
    .join('\n\n');
}

function buildJudgePrompt(testCase: TestCase, referenceSolution: string, generatedSolution: string): string {
  return `You are an expert code reviewer judging the quality of an AI-generated solution compared to a reference solution.

## Problem Statement
${testCase.problemStatement}

## Reference Solution
${referenceSolution}

## Generated Solution
${generatedSolution}

## Your Task
Compare the generated solution to the reference solution and score it on the following criteria:

1. **functionalEquivalence** (0-100): Does the generated solution produce the same behavior/output as the reference?
   - 0-20: Completely broken or unrelated — does not compile/run or solves a different problem entirely.
   - 21-40: Attempts the right problem but produces mostly incorrect output or crashes on typical inputs.
   - 41-60: Partially correct — handles some cases but has significant logic errors or missing branches.
   - 61-80: Mostly correct — produces the right output for common cases but fails on edge cases or error paths.
   - 81-100: Fully equivalent — produces identical behavior to the reference across all inputs and edge cases.

2. **apiCorrectness** (0-100): Does it use the correct SDK APIs as intended?
   - 0-20: Does not use the target SDK at all, or uses entirely wrong APIs (e.g. raw HTTP instead of the SDK client).
   - 21-40: Uses some SDK APIs but mostly the wrong ones, or calls them with incorrect arguments/signatures.
   - 41-60: Uses the right APIs but with notable misuse — wrong method overloads, missing required options, or deprecated APIs.
   - 61-80: Correct API selection with minor issues — e.g. slightly suboptimal method choice or unnecessary extra calls.
   - 81-100: Uses exactly the right APIs with correct arguments, options, and call sequences matching the reference.

3. **idiomaticUsage** (0-100): Does it follow idiomatic patterns for the SDK?
   - 0-20: Anti-patterns throughout — fights the SDK's design, reimplements built-in functionality, or ignores conventions.
   - 21-40: Works but written as if the developer never read the docs — manual workarounds for things the SDK handles natively.
   - 41-60: Acceptable but not idiomatic — uses the SDK correctly but misses helper utilities, builder patterns, or recommended approaches.
   - 61-80: Good usage with minor style gaps — e.g. manual error handling where the SDK provides middleware, or verbose config where defaults suffice.
   - 81-100: Textbook idiomatic usage — leverages SDK conventions, utilities, and patterns exactly as the documentation recommends.

4. **overallSimilarity** (0-100): Overall similarity to the reference solution in approach and quality.
   - 0-20: Entirely different approach with poor quality — would not pass code review.
   - 21-40: Recognizably attempts the same task but takes a fundamentally different (and worse) approach.
   - 41-60: Similar high-level approach but diverges significantly in implementation details or quality.
   - 61-80: Close to the reference — same approach and structure with minor differences in style or completeness.
   - 81-100: Nearly identical to the reference in approach, structure, and quality — differences are cosmetic at most.

5. **functionalMatch** (boolean): Does the generated solution functionally achieve the same goal? Set to true if the solution would pass the same acceptance tests as the reference, even if the implementation differs. Set to false if it fails to meet the core requirements.

6. **notes** (string): Brief explanation of your scoring rationale. Mention specific strengths or gaps that drove the scores.
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

  for (const field of ['functionalEquivalence', 'apiCorrectness', 'idiomaticUsage', 'overallSimilarity']) {
    if (typeof score[field] !== 'number' || score[field] < 0 || score[field] > 100) {
      errors.push(`${field} must be a number between 0 and 100`);
    }
  }

  if (typeof score.functionalMatch !== 'boolean') {
    errors.push('functionalMatch must be a boolean');
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
    functionalEquivalence: score.functionalEquivalence as number,
    apiCorrectness: score.apiCorrectness as number,
    idiomaticUsage: score.idiomaticUsage as number,
    overallSimilarity: score.overallSimilarity as number,
    functionalMatch: score.functionalMatch as boolean,
    notes: score.notes as string,
  };
}
