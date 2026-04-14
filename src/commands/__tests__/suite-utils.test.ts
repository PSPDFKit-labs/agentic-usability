import { describe, it, expect, vi } from 'vitest';
import { validateTestSuite, printSuiteTable } from '../suite-utils.js';
import { makeTestCase } from '../../__tests__/helpers/fixtures.js';

describe('validateTestSuite', () => {
  it('returns test cases for valid input', () => {
    const tc = makeTestCase();
    const result = validateTestSuite([tc]);
    expect(result).toEqual([tc]);
  });

  it('throws when input is not an array', () => {
    expect(() => validateTestSuite({})).toThrow(/must be a JSON array/);
  });

  it('throws when a test case is not an object', () => {
    expect(() => validateTestSuite(['string'])).toThrow(/not an object/);
  });

  it('throws when id is missing or empty', () => {
    const tc = makeTestCase({ id: '' });
    expect(() => validateTestSuite([tc])).toThrow(/missing or empty id/);
  });

  it('throws when problemStatement is missing or empty', () => {
    const tc = makeTestCase({ problemStatement: '' });
    expect(() => validateTestSuite([tc])).toThrow(/missing or empty problemStatement/);
  });

  it('throws when referenceSolution is not an array', () => {
    const tc = { ...makeTestCase(), referenceSolution: 'not array' };
    expect(() => validateTestSuite([tc])).toThrow(/referenceSolution must be an array/);
  });

  it('throws when referenceSolution items lack path or content', () => {
    const tc = { ...makeTestCase(), referenceSolution: [{ path: 'a.ts' }] };
    expect(() => validateTestSuite([tc])).toThrow(/must have path and content strings/);
  });

  it('throws when difficulty is invalid', () => {
    const tc = { ...makeTestCase(), difficulty: 'extreme' };
    expect(() => validateTestSuite([tc])).toThrow(/difficulty must be one of/);
  });

  it('throws when targetApis is not an array', () => {
    const tc = { ...makeTestCase(), targetApis: 'not array' };
    expect(() => validateTestSuite([tc])).toThrow(/targetApis must be an array/);
  });

  it('throws when expectedTokens is not an array', () => {
    const tc = { ...makeTestCase(), expectedTokens: 'not array' };
    expect(() => validateTestSuite([tc])).toThrow(/expectedTokens must be an array/);
  });

  it('throws when tags is not an array', () => {
    const tc = { ...makeTestCase(), tags: 'not array' };
    expect(() => validateTestSuite([tc])).toThrow(/tags must be an array/);
  });

  it('collects multiple errors across multiple test cases', () => {
    const tc1 = { ...makeTestCase(), id: '', difficulty: 'extreme' };
    const tc2 = { ...makeTestCase(), id: '', problemStatement: '' };
    expect(() => validateTestSuite([tc1, tc2])).toThrow(/Test suite validation failed/);
  });
});

describe('printSuiteTable', () => {
  it('logs a table to console', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printSuiteTable([makeTestCase()]);
    expect(spy).toHaveBeenCalled();
  });

  it('truncates long problem statements to 60 chars', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const longStatement = 'A'.repeat(100);
    printSuiteTable([makeTestCase({ problemStatement: longStatement })]);
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain('...');
    expect(output).not.toContain(longStatement);
  });
});
