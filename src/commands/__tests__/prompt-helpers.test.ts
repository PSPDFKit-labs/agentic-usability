import { describe, it, expect } from 'vitest';
import { buildSourceList, DIFFICULTY_RUBRIC, JUDGE_SCORING_CRITERIA, extractJson } from '../prompt-helpers.js';
import { makeConfig } from '../../__tests__/helpers/fixtures.js';

describe('buildSourceList', () => {
  it('returns a single bullet for one source', () => {
    const config = makeConfig({ privateInfo: [{ type: 'local', path: '/sdk' }] });
    const result = buildSourceList(['/sdk'], config);
    expect(result).toBe('- /sdk');
  });

  it('appends additionalContext inline', () => {
    const config = makeConfig({ privateInfo: [{ type: 'local', path: '/sdk', additionalContext: 'Focus on core' }] });
    const result = buildSourceList(['/sdk'], config);
    expect(result).toBe('- /sdk — Focus on core');
  });

  it('lists multiple sources', () => {
    const config = makeConfig({
      privateInfo: [
        { type: 'local', path: '/a' },
        { type: 'local', path: '/b', additionalContext: 'Only the API' },
      ],
    });
    const result = buildSourceList(['/a', '/b'], config);
    expect(result).toBe('- /a\n- /b — Only the API');
  });
});

describe('DIFFICULTY_RUBRIC', () => {
  it('contains all three difficulty levels', () => {
    expect(DIFFICULTY_RUBRIC).toContain('"easy"');
    expect(DIFFICULTY_RUBRIC).toContain('"medium"');
    expect(DIFFICULTY_RUBRIC).toContain('"hard"');
  });

  it('contains key rubric phrases', () => {
    expect(DIFFICULTY_RUBRIC).toContain('directly demonstrated in public documentation');
    expect(DIFFICULTY_RUBRIC).toContain('single-function level');
    expect(DIFFICULTY_RUBRIC).toContain('multi-function level');
  });
});

describe('JUDGE_SCORING_CRITERIA', () => {
  it('contains all six criteria', () => {
    expect(JUDGE_SCORING_CRITERIA).toContain('apiDiscovery');
    expect(JUDGE_SCORING_CRITERIA).toContain('callCorrectness');
    expect(JUDGE_SCORING_CRITERIA).toContain('completeness');
    expect(JUDGE_SCORING_CRITERIA).toContain('functionalCorrectness');
    expect(JUDGE_SCORING_CRITERIA).toContain('overallVerdict');
    expect(JUDGE_SCORING_CRITERIA).toContain('notes');
  });

  it('contains scoring bands', () => {
    expect(JUDGE_SCORING_CRITERIA).toContain('0-20');
    expect(JUDGE_SCORING_CRITERIA).toContain('81-100');
    expect(JUDGE_SCORING_CRITERIA).toContain('Used completely wrong or unrelated APIs');
  });
});

describe('extractJson', () => {
  it('extracts from fenced code block', () => {
    const text = 'Here is the result:\n```json\n[{"a":1}]\n```\nDone.';
    expect(extractJson(text)).toBe('[{"a":1}]');
  });

  it('extracts array by default', () => {
    const text = 'Some text [1,2,3] more text';
    expect(extractJson(text)).toBe('[1,2,3]');
  });

  it('extracts object when delimiter is "object"', () => {
    const text = 'Some text {"a":1} more text';
    expect(extractJson(text, 'object')).toBe('{"a":1}');
  });

  it('returns trimmed text when no delimiters found', () => {
    expect(extractJson('  hello  ')).toBe('hello');
  });

  it('prefers fenced block over raw delimiters', () => {
    const text = '```json\n{"fenced":true}\n```\n{"raw":true}';
    expect(extractJson(text, 'object')).toBe('{"fenced":true}');
  });
});
