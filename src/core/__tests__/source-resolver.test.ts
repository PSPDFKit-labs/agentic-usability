import { describe, it, expect, vi, beforeEach } from 'vitest';
import { access, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { resolveSource, resolveSources } from '../source-resolver.js';
import { makeConfig } from '../../__tests__/helpers/fixtures.js';
import type { SourceConfig } from '../../types.js';

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
      const result = await resolveSource({ type: 'local', path: '/tmp/sdk' });
      expect(result).toContain('/tmp/sdk');
    });

    it('appends subpath when configured', async () => {
      mockAccess.mockResolvedValue(undefined);
      const result = await resolveSource({ type: 'local', path: '/tmp/sdk', subpath: 'src' });
      expect(result).toContain('src');
    });

    it('throws when directory does not exist', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT'));
      await expect(resolveSource({ type: 'local', path: '/nonexistent' })).rejects.toThrow(/Directory not found/);
    });
  });

  describe('git source', () => {
    const gitSource: SourceConfig = { type: 'git', url: 'https://github.com/org/repo.git' };

    it('clones repo with shallow clone', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT'));
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
        cb(null, '', '');
        return undefined as any;
      });
      await resolveSource(gitSource);
      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['clone', '--depth', '1']),
        expect.any(Object),
        expect.any(Function),
      );
    });

    it('returns cached path without cloning when directory exists and not fresh', async () => {
      mockAccess.mockResolvedValue(undefined);
      const result = await resolveSource(gitSource);
      expect(result).toContain('deb25368bca2');
    });

    it('re-clones when fresh option is true', async () => {
      mockAccess.mockResolvedValue(undefined);
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
        cb(null, '', '');
        return undefined as any;
      });
      await resolveSource(gitSource, { fresh: true });
      expect(mockRm).toHaveBeenCalled();
      expect(mockExecFile).toHaveBeenCalled();
    });

    it('passes branch to git clone', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT'));
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
        cb(null, '', '');
        return undefined as any;
      });
      await resolveSource({ ...gitSource, branch: 'develop' });
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
      await resolveSource({ ...gitSource, sparse: ['src/', 'docs/'] });
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
      await expect(resolveSource(gitSource)).rejects.toThrow(/Git clone failed/);
    });
  });

  describe('url source', () => {
    it('fetches URL and saves as file', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT'));
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: async () => 'content',
      });
      const result = await resolveSource({ type: 'url', url: 'https://example.com/api.md' });
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
      await resolveSource({ type: 'url', url: 'https://example.com' });
      const writeCalls = mockWriteFile.mock.calls;
      const mdCall = writeCalls.find((c) => (c[0] as string).endsWith('.md'));
      expect(mdCall).toBeTruthy();
    });

    it('uses cached directory when exists and not fresh', async () => {
      mockAccess.mockResolvedValue(undefined);
      await resolveSource({ type: 'url', url: 'https://example.com' });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('warns and continues when URL fails', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT'));
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers(),
        text: async () => '',
      });
      await resolveSource({ type: 'url', url: 'https://fail.com' });
      expect(console.warn).toHaveBeenCalled();
    });

    it('throws when url is missing', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT'));
      await expect(resolveSource({ type: 'url' })).rejects.toThrow(/url/);
    });
  });
});

describe('resolveSources', () => {
  it('resolves all sources in config', async () => {
    mockAccess.mockResolvedValue(undefined);
    const config = makeConfig({
      sources: [
        { type: 'local', path: '/tmp/sdk1' },
        { type: 'local', path: '/tmp/sdk2' },
      ],
    });
    const result = await resolveSources(config);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('/tmp/sdk1');
    expect(result[1]).toContain('/tmp/sdk2');
  });
});
