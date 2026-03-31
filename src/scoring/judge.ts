import type { SolutionFile, JudgeScore, TestCase, AgentConfig } from '../core/types.js';
import { createAdapter } from '../agents/adapter.js';

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
2. **apiCorrectness** (0-100): Does it use the correct SDK APIs as intended?
3. **idiomaticUsage** (0-100): Does it follow idiomatic patterns for the SDK?
4. **overallSimilarity** (0-100): Overall similarity to the reference solution in approach and quality.
5. **functionalMatch** (boolean): Does the generated solution functionally achieve the same goal?
6. **notes** (string): Brief explanation of your scoring rationale.

Output ONLY a valid JSON object with these fields. No markdown fences, no explanation — just the raw JSON object.`;
}

function buildRetryPrompt(originalPrompt: string, error: string): string {
  return `${originalPrompt}

IMPORTANT: Your previous response was not valid JSON. The error was:
${error}

Please output ONLY a valid JSON object. No markdown code fences, no explanation text — just the raw JSON object starting with { and ending with }.`;
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

  let result = await adapter.execute(prompt, process.cwd());

  let jsonText = extractJsonObject(result.stdout);
  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    const parseError = err instanceof Error ? err.message : String(err);

    const retryPrompt = buildRetryPrompt(prompt, parseError);
    result = await adapter.execute(retryPrompt, process.cwd());

    jsonText = extractJsonObject(result.stdout);
    try {
      parsed = JSON.parse(jsonText);
    } catch (retryErr) {
      const retryParseError = retryErr instanceof Error ? retryErr.message : String(retryErr);
      throw new Error(`Judge output is not valid JSON after retry: ${retryParseError}`);
    }
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
