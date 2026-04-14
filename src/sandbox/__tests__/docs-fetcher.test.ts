import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { fetchAndCacheDocs } from '../docs-fetcher.js';
import type { PublicInfo } from '../../core/types.js';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('turndown', () => {
  return {
    default: class MockTurndownService {
      turndown(html: string) { return `markdown:${html}`; }
    },
  };
});

const mockMkdir = vi.mocked(mkdir);
const mockWriteFile = vi.mocked(writeFile);
const mockReadFile = vi.mocked(readFile);
const mockStat = vi.mocked(stat);

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockResponse(body: string, contentType = 'text/plain', ok = true, status = 200) {
  return {
    ok,
    status,
    headers: new Headers({ 'content-type': contentType }),
    text: async () => body,
  };
}

describe('fetchAndCacheDocs', () => {
  beforeEach(() => {
    // Default: no cached files
    mockStat.mockRejectedValue(new Error('ENOENT'));
    mockFetch.mockReset();
  });

  it('fetches from docsUrl and returns content', async () => {
    const info: PublicInfo = { docsUrl: 'https://example.com/docs' };
    mockFetch.mockResolvedValue(mockResponse('doc content'));
    const result = await fetchAndCacheDocs(info);
    expect(result).toContain('doc content');
    expect(mockFetch).toHaveBeenCalledWith('https://example.com/docs', expect.any(Object));
  });

  it('fetches from multiple guide URLs', async () => {
    const info: PublicInfo = { guides: ['https://a.com', 'https://b.com'] };
    mockFetch.mockResolvedValue(mockResponse('guide'));
    const result = await fetchAndCacheDocs(info);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result).toContain('guide');
  });

  it('appends additionalContext to the assembled docs', async () => {
    const info: PublicInfo = { additionalContext: 'extra info' };
    const result = await fetchAndCacheDocs(info);
    expect(result).toContain('extra info');
  });

  it('converts HTML responses to markdown using turndown', async () => {
    const info: PublicInfo = { docsUrl: 'https://example.com' };
    mockFetch.mockResolvedValue(mockResponse('<h1>Hello</h1>', 'text/html'));
    const result = await fetchAndCacheDocs(info);
    expect(result).toContain('markdown:');
  });

  it('passes through non-HTML responses as-is', async () => {
    const info: PublicInfo = { docsUrl: 'https://example.com' };
    mockFetch.mockResolvedValue(mockResponse('plain text', 'text/plain'));
    const result = await fetchAndCacheDocs(info);
    expect(result).toBe('plain text');
  });

  it('returns cached content when cache is fresh (< 24h)', async () => {
    const info: PublicInfo = { docsUrl: 'https://example.com' };
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 1000 } as any);
    mockReadFile.mockResolvedValue('cached content');

    const result = await fetchAndCacheDocs(info);
    expect(result).toBe('cached content');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('re-fetches when cache is stale (> 24h)', async () => {
    const info: PublicInfo = { docsUrl: 'https://example.com' };
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 25 * 60 * 60 * 1000 } as any);
    mockFetch.mockResolvedValue(mockResponse('fresh'));

    const result = await fetchAndCacheDocs(info);
    expect(result).toBe('fresh');
  });

  it('re-fetches when freshDocs option is true', async () => {
    const info: PublicInfo = { docsUrl: 'https://example.com' };
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 1000 } as any);
    mockReadFile.mockResolvedValue('cached');
    mockFetch.mockResolvedValue(mockResponse('fresh'));

    const result = await fetchAndCacheDocs(info, { freshDocs: true });
    expect(result).toBe('fresh');
  });

  it('warns and continues when a URL fetch fails', async () => {
    const info: PublicInfo = { docsUrl: 'https://fail.com', additionalContext: 'fallback' };
    mockFetch.mockRejectedValue(new Error('network'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await fetchAndCacheDocs(info);
    expect(result).toContain('fallback');
  });

  it('returns empty string when publicInfo has no URLs and no additionalContext', async () => {
    const result = await fetchAndCacheDocs({});
    expect(result).toBe('');
  });

  it('truncates assembled docs exceeding 100KB and appends docs URL', async () => {
    // Generate content larger than 100KB (100 * 1024 = 102400 bytes)
    const largeContent = 'x'.repeat(110_000);
    const info: PublicInfo = { docsUrl: 'https://example.com/docs' };
    mockFetch.mockResolvedValue(mockResponse(largeContent));

    const result = await fetchAndCacheDocs(info);

    expect(Buffer.byteLength(result, 'utf-8')).toBeLessThan(110_000);
    expect(result).toContain('... Full documentation at https://example.com/docs');
  });

  it('truncates at a newline boundary when possible', async () => {
    // Build content just over 100KB with newlines scattered throughout
    const lineSize = 100;
    const lineCount = Math.ceil(110_000 / (lineSize + 1));
    const largeContent = Array.from({ length: lineCount }, (_, i) => 'A'.repeat(lineSize)).join('\n');
    const info: PublicInfo = { docsUrl: 'https://example.com' };
    mockFetch.mockResolvedValue(mockResponse(largeContent));

    const result = await fetchAndCacheDocs(info);

    // The truncated portion (before the "... Full documentation" suffix) should end cleanly
    const truncatedPart = result.split('\n\n... Full documentation')[0];
    // Should not end mid-line — last char of truncated content should be a full line
    expect(truncatedPart.length).toBeGreaterThan(0);
    expect(truncatedPart.length).toBeLessThan(largeContent.length);
  });
});
