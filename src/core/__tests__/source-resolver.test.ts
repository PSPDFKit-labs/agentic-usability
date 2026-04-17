import { describe, it, expect, vi } from 'vitest';
import { access, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { resolveSource, resolveSources, getUrlSources } from '../source-resolver.js';
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

const mockAccess = vi.mocked(access);
const mockExecFile = vi.mocked(execFile);
const mockRm = vi.mocked(rm);

describe('resolveSource', () => {
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
    it('throws because URL sources are not resolved to filesystem paths', async () => {
      await expect(resolveSource({ type: 'url', url: 'https://example.com' })).rejects.toThrow(/URL sources are not resolved/);
    });
  });
});

describe('resolveSources', () => {
  it('resolves local and git sources, skipping url sources', async () => {
    mockAccess.mockResolvedValue(undefined);
    const config = makeConfig({
      sources: [
        { type: 'local', path: '/tmp/sdk1' },
        { type: 'url', url: 'https://example.com/docs' },
        { type: 'local', path: '/tmp/sdk2' },
      ],
    });
    const result = await resolveSources(config);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('/tmp/sdk1');
    expect(result[1]).toContain('/tmp/sdk2');
  });
});

describe('getUrlSources', () => {
  it('extracts url sources from config', () => {
    const config = makeConfig({
      sources: [
        { type: 'local', path: '/tmp/sdk' },
        { type: 'url', url: 'https://docs.example.com' },
        { type: 'url', url: 'https://api.example.com', additionalContext: 'API reference' },
      ],
    });
    const urls = getUrlSources(config);
    expect(urls).toEqual([
      { url: 'https://docs.example.com', additionalContext: undefined },
      { url: 'https://api.example.com', additionalContext: 'API reference' },
    ]);
  });

  it('returns empty array when no url sources exist', () => {
    const config = makeConfig({
      sources: [{ type: 'local', path: '/tmp/sdk' }],
    });
    expect(getUrlSources(config)).toEqual([]);
  });
});
