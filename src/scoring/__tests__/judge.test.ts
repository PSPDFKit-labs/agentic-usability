import { describe, it, expect, vi } from 'vitest';
import { formatSolution, runJudge } from '../judge.js';
import { createAdapter } from '../../agents/adapter.js';
import { makeTestCase, makeAgentResult, makeSolutionFile } from '../../__tests__/helpers/fixtures.js';

vi.mock('../../agents/adapter.js', () => ({
  createAdapter: vi.fn(),
}));

const mockCreateAdapter = vi.mocked(createAdapter);

function makeMockAdapter(opts: { stdout: string }) {
  return {
    name: 'mock',
    installCommand: null,
    run: vi.fn().mockResolvedValue(makeAgentResult({ stdout: opts.stdout })),
    interactive: vi.fn(),
    sandboxCommand: vi.fn().mockReturnValue(''),
  };
}

describe('formatSolution', () => {
  it('formats multiple files with path headers', () => {
    const files = [
      makeSolutionFile({ path: 'a.ts', content: 'code a' }),
      makeSolutionFile({ path: 'b.ts', content: 'code b' }),
    ];
    const result = formatSolution(files);
    expect(result).toContain('--- File: a.ts ---');
    expect(result).toContain('--- File: b.ts ---');
    expect(result).toContain('code a');
    expect(result).toContain('code b');
  });

  it('handles empty file array', () => {
    expect(formatSolution([])).toBe('');
  });

  it('handles single file', () => {
    const result = formatSolution([makeSolutionFile({ path: 'x.ts', content: 'hi' })]);
    expect(result).toContain('--- File: x.ts ---');
    expect(result).toContain('hi');
  });
});

describe('runJudge', () => {
  const validScore = JSON.stringify({
    functionalEquivalence: 90,
    apiCorrectness: 85,
    idiomaticUsage: 80,
    overallSimilarity: 88,
    functionalMatch: true,
    notes: 'Good implementation',
  });

  it('returns a valid JudgeScore when adapter returns valid JSON', async () => {
    const adapter = makeMockAdapter({ stdout: validScore });
    mockCreateAdapter.mockReturnValue(adapter);

    const tc = makeTestCase();
    const generated = [makeSolutionFile()];
    const result = await runJudge(tc, generated, { command: 'claude' }, 'claude');

    expect(result.testId).toBe('TC-001');
    expect(result.target).toBe('claude');
    expect(result.functionalEquivalence).toBe(90);
    expect(result.functionalMatch).toBe(true);
  });

  it('extracts JSON from markdown fenced blocks', async () => {
    const fenced = '```json\n' + validScore + '\n```';
    const adapter = makeMockAdapter({ stdout: fenced });
    mockCreateAdapter.mockReturnValue(adapter);

    const result = await runJudge(makeTestCase(), [makeSolutionFile()], { command: 'gemini' }, 'gemini');
    expect(result.functionalEquivalence).toBe(90);
  });

  it('extracts JSON object from mixed text', async () => {
    const mixed = 'Here is my analysis:\n' + validScore + '\nEnd of analysis.';
    const adapter = makeMockAdapter({ stdout: mixed });
    mockCreateAdapter.mockReturnValue(adapter);

    const result = await runJudge(makeTestCase(), [makeSolutionFile()], { command: 'gemini' }, 'gemini');
    expect(result.functionalEquivalence).toBe(90);
  });

  it('throws when output is not valid JSON', async () => {
    const adapter = makeMockAdapter({ stdout: 'not json' });
    mockCreateAdapter.mockReturnValue(adapter);

    await expect(runJudge(makeTestCase(), [makeSolutionFile()], { command: 'gemini' }, 'gemini'))
      .rejects.toThrow(/not valid JSON/);
  });

  it('throws when validation fails (out-of-range numbers)', async () => {
    const badScore = JSON.stringify({
      functionalEquivalence: 150,
      apiCorrectness: 85,
      idiomaticUsage: 80,
      overallSimilarity: 88,
      functionalMatch: true,
      notes: 'ok',
    });
    const adapter = makeMockAdapter({ stdout: badScore });
    mockCreateAdapter.mockReturnValue(adapter);

    await expect(runJudge(makeTestCase(), [makeSolutionFile()], { command: 'claude' }, 'claude'))
      .rejects.toThrow(/validation failed/);
  });

  it('throws when validation fails (missing fields)', async () => {
    const incomplete = JSON.stringify({ functionalEquivalence: 90 });
    const adapter = makeMockAdapter({ stdout: incomplete });
    mockCreateAdapter.mockReturnValue(adapter);

    await expect(runJudge(makeTestCase(), [makeSolutionFile()], { command: 'claude' }, 'claude'))
      .rejects.toThrow(/validation failed/);
  });
});
