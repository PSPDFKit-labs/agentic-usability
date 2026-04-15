import chalk from 'chalk';
import Table from 'cli-table3';
import { TestCase } from '../core/types.js';

export function validateTestCase(tc: unknown, index: number, options: { requireId?: boolean } = {}): string[] {
  const errors: string[] = [];
  if (typeof tc !== 'object' || tc === null || Array.isArray(tc)) {
    return [`Test case at index ${index} is not an object`];
  }

  const obj = tc as Record<string, unknown>;

  if (options.requireId !== false && (typeof obj.id !== 'string' || obj.id.length === 0)) {
    errors.push(`Test case ${index}: missing or empty id`);
  }

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

export function validateTestSuite(data: unknown): TestCase[] {
  if (!Array.isArray(data)) {
    throw new Error('Test suite must be a JSON array');
  }

  const allErrors: string[] = [];
  for (let i = 0; i < data.length; i++) {
    const errors = validateTestCase(data[i], i);
    allErrors.push(...errors);
  }

  if (allErrors.length > 0) {
    throw new Error(`Test suite validation failed:\n${allErrors.join('\n')}`);
  }

  return data as TestCase[];
}

export function printSuiteTable(testCases: TestCase[]): void {
  const table = new Table({
    head: [
      chalk.cyan('ID'),
      chalk.cyan('Difficulty'),
      chalk.cyan('Problem Statement'),
      chalk.cyan('APIs'),
    ],
  });

  for (const tc of testCases) {
    const truncated =
      tc.problemStatement.length > 60
        ? tc.problemStatement.slice(0, 57) + '...'
        : tc.problemStatement;
    table.push([tc.id, tc.difficulty, truncated, tc.targetApis.length.toString()]);
  }

  console.log(table.toString());
}
