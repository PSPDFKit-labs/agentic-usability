import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeConfig, makeTestCase, makeProjectPaths } from '../../__tests__/helpers/fixtures.js';

vi.mock('../../core/config.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../../core/paths.js', () => ({
  ensureProjectDirs: vi.fn(),
}));

vi.mock('../suite-utils.js', () => ({
  validateTestSuite: vi.fn(),
  printSuiteTable: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('node:readline/promises', () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn().mockResolvedValue('y'),
    close: vi.fn(),
  })),
}));

import { loadConfig } from '../../core/config.js';
import { validateTestSuite, printSuiteTable } from '../suite-utils.js';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { importCommand } from '../import.js';

const paths = makeProjectPaths();

describe('importCommand', () => {
  const validSuite = [makeTestCase()];

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    vi.mocked(loadConfig).mockResolvedValue(makeConfig());
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(validSuite));
    vi.mocked(validateTestSuite).mockReturnValue(validSuite);
    vi.mocked(stat).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(writeFile).mockResolvedValue(undefined);
  });

  it('reads, validates, and writes imported suite file', async () => {
    await importCommand(paths, { input: '/tmp/suite.json' });

    expect(readFile).toHaveBeenCalledWith(
      expect.stringContaining('suite.json'),
      'utf-8',
    );
    expect(validateTestSuite).toHaveBeenCalledWith(validSuite);
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining('suite.json'),
      expect.any(String),
      'utf-8',
    );
    expect(printSuiteTable).toHaveBeenCalledWith(validSuite);
  });

  it('throws when input file does not exist', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

    await expect(importCommand(paths, { input: '/tmp/missing.json' })).rejects.toThrow(
      /Input file not found/,
    );
  });

  it('throws when input file is not valid JSON', async () => {
    vi.mocked(readFile).mockResolvedValue('not json {{{');

    await expect(importCommand(paths, { input: '/tmp/bad.json' })).rejects.toThrow(
      /not valid JSON/,
    );
  });

  it('throws when test suite validation fails', async () => {
    vi.mocked(validateTestSuite).mockImplementation(() => {
      throw new Error('validation failed');
    });

    await expect(importCommand(paths, { input: '/tmp/suite.json' })).rejects.toThrow(
      /validation failed/,
    );
  });
});
