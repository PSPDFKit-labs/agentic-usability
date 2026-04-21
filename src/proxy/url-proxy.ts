import { appendFile, mkdir } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Config } from '../types.js';

const PROXY_PREFIX = '/__agentic_url_proxy__';
const TEXT_CONTENT_TYPES = [
  'text/plain',
  'text/html',
  'application/json',
  'application/json; charset=utf-8',
  'application/javascript',
  'text/javascript',
  'application/xml',
  'text/xml',
  'text/css',
  'text/markdown',
];

export interface UrlProxyHandle {
  localBaseUrl: string;
  sandboxBaseUrl: string;
  accessLogPath: string;
  stop(): Promise<void>;
}

interface RemoteTarget {
  protocol: 'http' | 'https';
  host: string;
  pathWithSearch: string;
}

export function collectTrackedUrls(config: Config): string[] {
  const urls = new Set<string>();

  for (const source of config.sources) {
    if (source.type === 'url' && source.url && /^https?:\/\//.test(source.url)) {
      urls.add(source.url);
    }
  }

  if (config.publicInfo?.docsUrl && /^https?:\/\//.test(config.publicInfo.docsUrl)) {
    urls.add(config.publicInfo.docsUrl);
  }

  for (const guide of config.publicInfo?.guides ?? []) {
    if (/^https?:\/\//.test(guide)) {
      urls.add(guide);
    }
  }

  return [...urls];
}

export function makeProxyUrl(originalUrl: string, baseUrl: string): string {
  const remote = new URL(originalUrl);
  return `${baseUrl}${PROXY_PREFIX}/${remote.protocol.replace(':', '')}/${encodeURIComponent(remote.host)}${remote.pathname}${remote.search}`;
}

export function rewriteConfigUrlsForProxy(config: Config, baseUrl: string): Config {
  const rewrite = (value: string | undefined): string | undefined => {
    if (!value || !/^https?:\/\//.test(value)) return value;
    return makeProxyUrl(value, baseUrl);
  };

  return {
    ...config,
    sources: config.sources.map((source) =>
      source.type === 'url' && source.url
        ? { ...source, url: rewrite(source.url)! }
        : source,
    ),
    publicInfo: config.publicInfo
      ? {
          ...config.publicInfo,
          docsUrl: rewrite(config.publicInfo.docsUrl),
          guides: config.publicInfo.guides?.map((guide) => rewrite(guide) ?? guide),
        }
      : undefined,
  };
}

export async function startUrlProxy(
  config: Config,
  projectRoot: string,
  sandboxHostAddress: string,
): Promise<UrlProxyHandle | undefined> {
  const tracked = collectTrackedUrls(config);
  if (tracked.length === 0) return undefined;

  const logsDir = join(projectRoot, 'logs');
  await mkdir(logsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const accessLogPath = join(logsDir, `url-proxy-access-${stamp}.jsonl`);

  const server = createServer(async (req, res) => {
    try {
      if (!req.url) {
        res.writeHead(400).end('Missing URL');
        return;
      }

      if (req.url === '/__health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      const remote = parseProxyPath(req.url);
      if (!remote) {
        res.writeHead(404).end('Unknown proxy path');
        return;
      }

      const upstreamUrl = `${remote.protocol}://${remote.host}${remote.pathWithSearch}`;
      const upstream = await fetch(upstreamUrl, {
        method: req.method,
        headers: {
          'user-agent': req.headers['user-agent'] || 'agentic-usability-url-proxy',
          'accept': req.headers.accept || '*/*',
        },
        redirect: 'follow',
      });

      await logAccess(accessLogPath, req, upstreamUrl);

      const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
      const bodyBuffer = Buffer.from(await upstream.arrayBuffer());
      const body = shouldRewriteContent(contentType)
        ? Buffer.from(rewriteBody(bodyBuffer.toString('utf8'), remote, currentBaseUrl(req), sandboxHostAddress), 'utf8')
        : bodyBuffer;

      res.writeHead(upstream.status, {
        'content-type': contentType,
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch (error) {
      const failedUrl = req.url
        ? parseProxyPath(req.url)
        : null;
      const upstreamUrl = failedUrl
        ? `${failedUrl.protocol}://${failedUrl.host}${failedUrl.pathWithSearch}`
        : 'unknown';
      console.warn(`URL proxy fetch failed for ${upstreamUrl}:`, error);
      if (failedUrl) {
        await logAccess(accessLogPath, req, upstreamUrl, error instanceof Error ? error.message : String(error));
      }
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to determine URL proxy port');
  }

  const port = address.port;
  return {
    localBaseUrl: `http://127.0.0.1:${port}`,
    sandboxBaseUrl: `http://${sandboxHostAddress}:${port}`,
    accessLogPath,
    stop: async () => {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
}

function currentBaseUrl(req: IncomingMessage): string {
  const host = req.headers.host ?? '127.0.0.1';
  return `http://${host}`;
}

function shouldRewriteContent(contentType: string): boolean {
  return TEXT_CONTENT_TYPES.some((type) => contentType.includes(type));
}

function parseProxyPath(path: string): RemoteTarget | null {
  const base = 'http://proxy.local';
  const url = new URL(path, base);
  if (!url.pathname.startsWith(`${PROXY_PREFIX}/`)) return null;

  const rest = url.pathname.slice(`${PROXY_PREFIX}/`.length);
  const parts = rest.split('/');
  const protocol = parts.shift();
  const encodedHost = parts.shift();
  if (!protocol || !encodedHost || (protocol !== 'http' && protocol !== 'https')) return null;

  const host = decodeURIComponent(encodedHost);
  const pathname = `/${parts.join('/')}`;
  return {
    protocol,
    host,
    pathWithSearch: `${pathname}${url.search}`,
  };
}

async function logAccess(
  accessLogPath: string,
  req: IncomingMessage,
  upstreamUrl: string,
  error?: string,
): Promise<void> {
  const upstream = new URL(upstreamUrl);
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    method: req.method,
    path: upstream.pathname,
    query: upstream.search,
    upstream: upstreamUrl,
    referer: req.headers.referer || null,
    userAgent: req.headers['user-agent'] || null,
    error: error ?? null,
  }) + '\n';
  await appendFile(accessLogPath, line, 'utf8');
}

function rewriteBody(
  body: string,
  remote: RemoteTarget,
  requestBaseUrl: string,
  sandboxHostAddress: string,
): string {
  const publicProxyBase = `${requestBaseUrl}${PROXY_PREFIX}/${remote.protocol}/${encodeURIComponent(remote.host)}`;
  const sandboxProxyBase = `http://${sandboxHostAddress}${PROXY_PREFIX}/${remote.protocol}/${encodeURIComponent(remote.host)}`;
  const remoteOrigin = `${remote.protocol}://${remote.host}`;

  return body
    .replaceAll(remoteOrigin, `${requestBaseUrl}${PROXY_PREFIX}/${remote.protocol}/${encodeURIComponent(remote.host)}`)
    .replaceAll(`href="/`, `href="${publicProxyBase}/`)
    .replaceAll(`src="/`, `src="${publicProxyBase}/`)
    .replaceAll(`href='/`, `href='${publicProxyBase}/`)
    .replaceAll(`src='/`, `src='${publicProxyBase}/`)
    .replaceAll(`content="/`, `content="${publicProxyBase}/`)
    .replaceAll(`content='/`, `content='${publicProxyBase}/`)
    .replaceAll(`url(/`, `url(${publicProxyBase}/`)
    .replaceAll(requestBaseUrl, requestBaseUrl)
    .replaceAll(sandboxProxyBase, `${requestBaseUrl}${PROXY_PREFIX}/${remote.protocol}/${encodeURIComponent(remote.host)}`);
}
