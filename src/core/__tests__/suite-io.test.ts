import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { loadTestSuite, loadSolution, saveResult, formatElapsed } from '../suite-io.js';
import type { Config } from '../types.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockMkdir = vi.mocked(mkdir);

describe('formatElapsed', () => {
  it('formats seconds only (< 60s)', () => {
    expect(formatElapsed(5000)).toBe('5s');
  });

  it('formats minutes and seconds', () => {
    expect(formatElapsed(125000)).toBe('2m5s');
  });

  it('formats 0 milliseconds as "0s"', () => {
    expect(formatElapsed(0)).toBe('0s');
  });

  it('formats exactly 60 seconds as "1m0s"', () => {
    expect(formatElapsed(60000)).toBe('1m0s');
  });

  it('truncates sub-second values', () => {
    expect(formatElapsed(1500)).toBe('1s');
  });
});

describe('loadTestSuite', () => {
  const config: Config = {
    source: { type: 'local', path: '/tmp' },
    targets: [{ name: 'claude', image: 'node:20' }],
    sandbox: { domain: 'localhost' },
  };

  it('reads and parses suite file from default path', async () => {
    const suite = [{ id: 'TC-001' }];
    mockReadFile.mockResolvedValue(JSON.stringify(suite));
    const result = await loadTestSuite(config);
    expect(result).toEqual(suite);
  });

  it('uses custom suiteFile from config.output', async () => {
    const customConfig = { ...config, output: { suiteFile: 'custom/suite.json' } };
    mockReadFile.mockResolvedValue('[]');
    await loadTestSuite(customConfig);
    expect(mockReadFile).toHaveBeenCalledWith(expect.stringContaining('custom/suite.json'), 'utf-8');
  });

  it('throws when suite file does not exist', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    await expect(loadTestSuite(config)).rejects.toThrow(/Test suite not found/);
  });

  it('throws when suite file is not valid JSON', async () => {
    mockReadFile.mockResolvedValue('not json');
    await expect(loadTestSuite(config)).rejects.toThrow();
  });

  it('throws when parsed data is not an array', async () => {
    mockReadFile.mockResolvedValue('{"key": "value"}');
    await expect(loadTestSuite(config)).rejects.toThrow(/not a JSON array/);
  });
});

describe('loadSolution', () => {
  it('reads and returns solution files for a test with target', async () => {
    const files = [{ path: 'a.ts', content: 'code' }];
    mockReadFile.mockResolvedValue(JSON.stringify(files));
    const result = await loadSolution('TC-001', 'claude');
    expect(result).toEqual(files);
    expect(mockReadFile).toHaveBeenCalledWith(expect.stringContaining('claude/TC-001/generated-solution.json'), 'utf-8');
  });

  it('reads and returns solution files for a test without target', async () => {
    const files = [{ path: 'a.ts', content: 'code' }];
    mockReadFile.mockResolvedValue(JSON.stringify(files));
    const result = await loadSolution('TC-001');
    expect(result).toEqual(files);
  });

  it('returns null when solution file does not exist', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    const result = await loadSolution('TC-001', 'claude');
    expect(result).toBeNull();
  });
});

describe('saveResult', () => {
  it('creates directory and writes file with target', async () => {
    await saveResult('TC-001', 'output.json', '{}', 'claude');
    expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining('claude/TC-001'), { recursive: true });
    expect(mockWriteFile).toHaveBeenCalledWith(expect.stringContaining('output.json'), '{}', 'utf-8');
  });

  it('creates directory and writes file without target', async () => {
    await saveResult('TC-001', 'output.json', '{}');
    expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining('TC-001'), { recursive: true });
  });
});
