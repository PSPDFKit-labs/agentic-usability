import { describe, it, expect, vi, beforeEach } from 'vitest';
import { access, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { resolveSource } from '../source-resolver.js';
import { makeConfig } from '../../__tests__/helpers/fixtures.js';

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  rm: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('turndown', () => {
  return {
    default: class MockTurndownService {
      turndown(html: string) { return `md:${html}`; }
    },
  };
});

const mockAccess = vi.mocked(access);
const mockMkdir = vi.mocked(mkdir);
const mockExecFile = vi.mocked(execFile);
const mockRm = vi.mocked(rm);

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('resolveSource', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('local source', () => {
    it('returns resolved path when directory exists', async () => {
      mockAccess.mockResolvedValue(undefined);
      const config = makeConfig({ source: { type: 'local', path: '/tmp/sdk' } });
      const result = await resolveSource(config);
      expect(result).toContain('/tmp/sdk');
    });

    it('appends subpath when configured', async () => {
      mockAccess.mockResolvedValue(undefined);
      const config = makeConfig({ source: { type: 'local', path: '/tmp/sdk', subpath: 'src' } });
      const result = await resolveSource(config);
      expect(result).toContain('src');
    });

    it('throws when directory does not exist', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT'));
      const config = makeConfig({ source: { type: 'local', path: '/nonexistent' } });
      await expect(resolveSource(config)).rejects.toThrow(/Directory not found/);
    });
  });

  describe('git source', () => {
    it('clones repo with shallow clone', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT'));
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
        cb(null, '', '');
        return undefined as any;
      });
      const config = makeConfig({ source: { type: 'git', url: 'https://github.com/org/repo.git' } });
      await resolveSource(config);
      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['clone', '--depth', '1']),
        expect.any(Object),
        expect.any(Function),
      );
    });

    it('returns cached path without cloning when directory exists and not fresh', async () => {
      // When the cached dir exists, resolveGit should return the path without calling git
      mockAccess.mockResolvedValue(undefined);
      const config = makeConfig({ source: { type: 'git', url: 'https://github.com/org/repo.git' } });
      const result = await resolveSource(config);
      // Should return a truthy path containing the hash
      expect(result).toContain('deb25368bca2');
    });

    it('re-clones when fresh option is true', async () => {
      mockAccess.mockResolvedValue(undefined);
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
        cb(null, '', '');
        return undefined as any;
      });
      const config = makeConfig({ source: { type: 'git', url: 'https://github.com/org/repo.git' } });
      await resolveSource(config, { fresh: true });
      expect(mockRm).toHaveBeenCalled();
      expect(mockExecFile).toHaveBeenCalled();
    });

    it('passes branch to git clone', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT'));
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
        cb(null, '', '');
        return undefined as any;
      });
      const config = makeConfig({ source: { type: 'git', url: 'https://github.com/org/repo.git', branch: 'develop' } });
      await resolveSource(config);
      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['--branch', 'develop']),
        expect.any(Object),
        expect.any(Function),
      );
    });

    it('uses sparse checkout when sparse paths are configured', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT'));
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
        cb(null, '', '');
        return undefined as any;
      });
      const config = makeConfig({
        source: { type: 'git', url: 'https://github.com/org/repo.git', sparse: ['src/', 'docs/'] },
      });
      await resolveSource(config);
      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['init']),
        expect.any(Object),
        expect.any(Function),
      );
    });

    it('throws when git clone fails', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT'));
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
        cb(new Error('clone failed'), '', 'fatal: not found');
        return undefined as any;
      });
      const config = makeConfig({ source: { type: 'git', url: 'https://github.com/org/repo.git' } });
      await expect(resolveSource(config)).rejects.toThrow(/Git clone failed/);
    });
  });

  describe('url source', () => {
    it('fetches URLs and saves as files', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT'));
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: async () => 'content',
      });
      const config = makeConfig({ source: { type: 'url', urls: ['https://example.com/api.md'] } });
      const result = await resolveSource(config);
      expect(result).toBeTruthy();
      expect(mockFetch).toHaveBeenCalledWith('https://example.com/api.md');
    });

    it('converts HTML to markdown', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT'));
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => '<h1>Hi</h1>',
      });
      const mockWriteFile = vi.mocked(writeFile);
      mockWriteFile.mockClear();
      const config = makeConfig({ source: { type: 'url', urls: ['https://example.com'] } });
      await resolveSource(config);
      // Find the writeFile call that writes the fetched content (not the mkdir/sparse calls)
      const writeCalls = mockWriteFile.mock.calls;
      const mdCall = writeCalls.find((c) => (c[0] as string).endsWith('.md'));
      expect(mdCall).toBeTruthy();
    });

    it('uses cached directory when exists and not fresh', async () => {
      mockAccess.mockResolvedValue(undefined);
      const config = makeConfig({ source: { type: 'url', urls: ['https://example.com'] } });
      await resolveSource(config);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('warns and continues when a URL fails', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT'));
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers(),
        text: async () => '',
      });
      const config = makeConfig({ source: { type: 'url', urls: ['https://fail.com'] } });
      await resolveSource(config);
      expect(console.warn).toHaveBeenCalled();
    });

    it('throws when urls array is empty', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT'));
      const config = makeConfig({ source: { type: 'url', urls: [] } });
      await expect(resolveSource(config)).rejects.toThrow(/non-empty/);
    });
  });
});
