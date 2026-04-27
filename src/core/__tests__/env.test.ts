import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { loadDotenv } from '../env.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockReadFile = vi.mocked(readFile);
const mockExecFileSync = vi.mocked(execFileSync);

describe('loadDotenv', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    mockExecFileSync.mockReset();
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

  describe('1Password (op://) references', () => {
    it('resolves op:// values via op read', async () => {
      mockReadFile.mockResolvedValue('API_KEY=op://Vault/Item/field');
      mockExecFileSync.mockReturnValue('resolved-secret\n');
      delete process.env.API_KEY;

      await loadDotenv('/tmp');

      expect(mockExecFileSync).toHaveBeenCalledWith(
        'op', ['read', 'op://Vault/Item/field'],
        expect.objectContaining({ encoding: 'utf-8', timeout: 10_000 }),
      );
      expect(process.env.API_KEY).toBe('resolved-secret');
    });

    it('resolves op:// values inside quotes', async () => {
      mockReadFile.mockResolvedValue('API_KEY="op://Vault/Item/field"');
      mockExecFileSync.mockReturnValue('secret\n');
      delete process.env.API_KEY;

      await loadDotenv('/tmp');
      expect(process.env.API_KEY).toBe('secret');
    });

    it('does not call op for non-op:// values', async () => {
      mockReadFile.mockResolvedValue('PLAIN=hello');
      delete process.env.PLAIN;

      await loadDotenv('/tmp');
      expect(mockExecFileSync).not.toHaveBeenCalled();
      expect(process.env.PLAIN).toBe('hello');
    });

    it('throws a clear error when op read fails', async () => {
      mockReadFile.mockResolvedValue('KEY=op://Vault/Missing/field');
      mockExecFileSync.mockImplementation(() => { throw new Error('item not found'); });
      delete process.env.KEY;

      await expect(loadDotenv('/tmp')).rejects.toThrow(/Failed to resolve 1Password reference for KEY/);
      await expect(loadDotenv('/tmp')).rejects.toThrow(/op signin/);
    });

    it('skips op:// resolution when shell env already has the key', async () => {
      process.env.EXISTING_KEY = 'from-shell';
      mockReadFile.mockResolvedValue('EXISTING_KEY=op://Vault/Item/field');

      await loadDotenv('/tmp');
      expect(mockExecFileSync).not.toHaveBeenCalled();
      expect(process.env.EXISTING_KEY).toBe('from-shell');
    });
  });
});
