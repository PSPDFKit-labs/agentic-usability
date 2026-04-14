import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { loadDotenv } from '../env.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

const mockReadFile = vi.mocked(readFile);

describe('loadDotenv', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('parses KEY=VALUE lines and sets process.env', async () => {
    mockReadFile.mockResolvedValue('FOO=bar\nBAZ=qux');
    delete process.env.FOO;
    delete process.env.BAZ;
    await loadDotenv('/tmp');
    expect(process.env.FOO).toBe('bar');
    expect(process.env.BAZ).toBe('qux');
  });

  it('strips double quotes from values', async () => {
    mockReadFile.mockResolvedValue('KEY="hello world"');
    delete process.env.KEY;
    await loadDotenv('/tmp');
    expect(process.env.KEY).toBe('hello world');
  });

  it('strips single quotes from values', async () => {
    mockReadFile.mockResolvedValue("KEY='hello world'");
    delete process.env.KEY;
    await loadDotenv('/tmp');
    expect(process.env.KEY).toBe('hello world');
  });

  it('skips blank lines', async () => {
    mockReadFile.mockResolvedValue('A=1\n\n\nB=2');
    delete process.env.A;
    delete process.env.B;
    await loadDotenv('/tmp');
    expect(process.env.A).toBe('1');
    expect(process.env.B).toBe('2');
  });

  it('skips comment lines (starting with #)', async () => {
    mockReadFile.mockResolvedValue('# comment\nA=1');
    delete process.env.A;
    await loadDotenv('/tmp');
    expect(process.env.A).toBe('1');
  });

  it('skips lines without an = sign', async () => {
    mockReadFile.mockResolvedValue('no equals here\nA=1');
    delete process.env.A;
    await loadDotenv('/tmp');
    expect(process.env.A).toBe('1');
  });

  it('does not overwrite existing process.env values', async () => {
    process.env.EXISTING = 'original';
    mockReadFile.mockResolvedValue('EXISTING=overwritten');
    await loadDotenv('/tmp');
    expect(process.env.EXISTING).toBe('original');
  });

  it('silently returns when .env file does not exist', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    await expect(loadDotenv('/tmp')).resolves.toBeUndefined();
  });

  it('handles values containing = signs', async () => {
    mockReadFile.mockResolvedValue('URL=http://host?a=1&b=2');
    delete process.env.URL;
    await loadDotenv('/tmp');
    expect(process.env.URL).toBe('http://host?a=1&b=2');
  });

  it('trims whitespace around keys and values', async () => {
    mockReadFile.mockResolvedValue('  KEY  =  value  ');
    delete process.env.KEY;
    await loadDotenv('/tmp');
    expect(process.env.KEY).toBe('value');
  });
});
