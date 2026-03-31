import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import TurndownService from 'turndown';
import type { PublicInfo } from '../core/types.js';

const CACHE_DIR = '.agentic-usability/cache/docs';
const MAX_DOCS_BYTES = 100 * 1024; // 100KB
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface FetchDocsOptions {
  freshDocs?: boolean;
}

export async function fetchAndCacheDocs(
  publicInfo: PublicInfo,
  options: FetchDocsOptions = {},
): Promise<string> {
  const cacheDir = resolve(CACHE_DIR);
  await mkdir(cacheDir, { recursive: true });

  const urls: string[] = [];
  if (publicInfo.docsUrl) {
    urls.push(publicInfo.docsUrl);
  }
  if (publicInfo.guides) {
    urls.push(...publicInfo.guides);
  }

  const turndown = new TurndownService();
  const sections: string[] = [];

  for (const url of urls) {
    try {
      const content = await fetchWithCache(
        url,
        cacheDir,
        turndown,
        options.freshDocs,
      );
      sections.push(content);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`Warning: Could not fetch docs from ${url}: ${message}`);
    }
  }

  if (publicInfo.additionalContext) {
    sections.push(publicInfo.additionalContext);
  }

  let assembled = sections.join('\n\n---\n\n');

  if (Buffer.byteLength(assembled, 'utf-8') > MAX_DOCS_BYTES) {
    const mainUrl = publicInfo.docsUrl ?? urls[0] ?? '';
    assembled = truncateToBytes(assembled, MAX_DOCS_BYTES);
    assembled += `\n\n... Full documentation at ${mainUrl}`;
  }

  return assembled;
}

async function fetchWithCache(
  url: string,
  cacheDir: string,
  turndown: TurndownService,
  fresh?: boolean,
): Promise<string> {
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 12);
  const cachePath = join(cacheDir, `${hash}.md`);

  if (!fresh) {
    const cached = await readCachedIfFresh(cachePath);
    if (cached !== null) {
      return cached;
    }
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const body = await response.text();

  let markdown: string;
  if (contentType.includes('text/html')) {
    markdown = turndown.turndown(body);
  } else {
    markdown = body;
  }

  await writeFile(cachePath, markdown, 'utf-8');
  return markdown;
}

async function readCachedIfFresh(
  cachePath: string,
): Promise<string | null> {
  try {
    const fileStat = await stat(cachePath);
    const age = Date.now() - fileStat.mtimeMs;
    if (age < CACHE_TTL_MS) {
      return await readFile(cachePath, 'utf-8');
    }
  } catch {
    // File doesn't exist or can't be read — not cached
  }
  return null;
}

function truncateToBytes(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, 'utf-8');
  if (buf.length <= maxBytes) {
    return text;
  }
  // Slice at byte boundary and decode, trimming any partial multi-byte char
  const sliced = buf.subarray(0, maxBytes).toString('utf-8');
  // Find last newline to avoid cutting mid-line
  const lastNewline = sliced.lastIndexOf('\n');
  if (lastNewline > maxBytes * 0.8) {
    return sliced.slice(0, lastNewline);
  }
  return sliced;
}
