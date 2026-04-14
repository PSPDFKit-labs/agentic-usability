import { describe, it, expect } from 'vitest';
import { analyzeTokens } from '../tokens.js';
import type { SolutionFile } from '../../core/types.js';

describe('analyzeTokens', () => {
  const solution: SolutionFile[] = [
    { path: 'index.ts', content: 'import { createClient } from "sdk";\nconst client = createClient();\nclient.query("SELECT * FROM users");' },
    { path: 'helper.ts', content: 'export function formatResponse(data: any) { return JSON.stringify(data); }' },
  ];

  it('returns 100% coverage when all APIs and tokens are found', () => {
    const result = analyzeTokens(solution, ['createClient', 'query'], ['import', 'export'], 'TC-001', 'claude');
    expect(result.apiCoverage).toBe(100);
    expect(result.tokenCoverage).toBe(100);
    expect(result.apis.every((a) => a.found)).toBe(true);
    expect(result.tokens.every((t) => t.found)).toBe(true);
  });

  it('returns 0% coverage when no APIs or tokens are found', () => {
    const result = analyzeTokens(solution, ['nonExistent', 'alsoMissing'], ['zzzzzz'], 'TC-001', 'claude');
    expect(result.apiCoverage).toBe(0);
    expect(result.tokenCoverage).toBe(0);
  });

  it('correctly identifies which file contains each API', () => {
    const result = analyzeTokens(solution, ['createClient', 'formatResponse'], [], 'TC-001', 'claude');
    expect(result.apis[0].foundIn).toBe('index.ts');
    expect(result.apis[1].foundIn).toBe('helper.ts');
  });

  it('handles empty targetApis array (returns 100% apiCoverage)', () => {
    const result = analyzeTokens(solution, [], ['import'], 'TC-001', 'claude');
    expect(result.apiCoverage).toBe(100);
  });

  it('handles empty expectedTokens array (returns 100% tokenCoverage)', () => {
    const result = analyzeTokens(solution, ['createClient'], [], 'TC-001', 'claude');
    expect(result.tokenCoverage).toBe(100);
  });

  it('handles empty solution files array', () => {
    const result = analyzeTokens([], ['createClient'], ['import'], 'TC-001', 'claude');
    expect(result.apiCoverage).toBe(0);
    expect(result.tokenCoverage).toBe(0);
  });

  it('escapes regex special characters in API names', () => {
    // The API uses word-boundary matching (\b), so "array.map()" won't match with \b around it
    // since ")" is not a word char. Test with a simpler special-char API that has word boundaries.
    const sol: SolutionFile[] = [{ path: 'a.ts', content: 'use array.map here' }];
    const result = analyzeTokens(sol, ['array.map'], [], 'TC-001', 'claude');
    expect(result.apis[0].found).toBe(true);
    // Also verify that the dot is escaped (doesn't match "arrayXmap")
    const sol2: SolutionFile[] = [{ path: 'a.ts', content: 'use arrayXmap here' }];
    const result2 = analyzeTokens(sol2, ['array.map'], [], 'TC-001', 'claude');
    expect(result2.apis[0].found).toBe(false);
  });

  it('treats expectedTokens as regex patterns when valid', () => {
    const result = analyzeTokens(solution, [], ['function|const'], 'TC-001', 'claude');
    expect(result.tokens[0].found).toBe(true);
  });

  it('falls back to escaped literal when expectedToken is invalid regex', () => {
    const sol: SolutionFile[] = [{ path: 'a.ts', content: 'a[b' }];
    const result = analyzeTokens(sol, [], ['a[b'], 'TC-001', 'claude');
    expect(result.tokens[0].found).toBe(true);
  });

  it('reports partial coverage correctly', () => {
    const result = analyzeTokens(solution, ['createClient', 'nonExistent', 'query', 'missing'], [], 'TC-001', 'claude');
    expect(result.apiCoverage).toBe(50);
  });

  it('searches across multiple solution files', () => {
    const result = analyzeTokens(solution, ['createClient', 'formatResponse'], [], 'TC-001', 'claude');
    expect(result.apiCoverage).toBe(100);
  });

  it('includes testId and target in the result', () => {
    const result = analyzeTokens([], [], [], 'TC-042', 'gemini');
    expect(result.testId).toBe('TC-042');
    expect(result.target).toBe('gemini');
  });
});
