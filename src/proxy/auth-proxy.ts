/**
 * Lightweight HTTP auth proxy that injects API credentials into requests
 * forwarded to upstream API servers.
 *
 * Each unique upstream gets its own listener on a separate ephemeral port,
 * so the agent CLI's *_BASE_URL env var maps unambiguously to one upstream.
 *
 * Secrets never enter the sandbox environment.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { gunzipSync, brotliDecompressSync, inflateSync } from 'node:zlib';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { ProxyTarget } from './env-rewriter.js';

export interface ProxyListener {
  /** The BASE_URL env var this listener serves (e.g. "ANTHROPIC_BASE_URL") */
  baseUrlVar: string;
  /** Ephemeral port the listener is bound to */
  port: number;
}

export interface ProxyLogEntry {
  timestamp: string;
  method: string;
  url: string;
  upstreamUrl: string;
  status: number;
  durationMs: number;
  requestBody?: string;
  responseBody?: string;
  /** Test case ID extracted from the proxy tag in the incoming auth header */
  testCaseId?: string;
  error?: string;
}

export interface AuthProxyHandle {
  /** One listener per unique baseUrlVar */
  listeners: ProxyListener[];
  /** Returns all recorded proxy request log entries */
  getLogs(): ProxyLogEntry[];
  /** Returns log entries for a specific test case */
  getLogsForTestCase(testCaseId: string): ProxyLogEntry[];
  stop(): Promise<void>;
}

/**
 * Start one HTTP proxy listener per unique upstream (keyed by `baseUrlVar`).
 *
 * When multiple secrets share the same `baseUrlVar`, the last target wins.
 */
export async function startAuthProxy(
  targets: ProxyTarget[],
  baseUrlVarForTarget: Map<string, string>,
): Promise<AuthProxyHandle> {
  if (targets.length === 0) {
    throw new Error('At least one proxy target is required');
  }

  // Group targets by baseUrlVar (last wins for same baseUrlVar)
  const targetByBaseUrlVar = new Map<string, ProxyTarget>();
  for (const t of targets) {
    const baseUrlVar = baseUrlVarForTarget.get(t.envVar);
    if (baseUrlVar) {
      targetByBaseUrlVar.set(baseUrlVar, t);
    }
  }

  const servers: Server[] = [];
  const listeners: ProxyListener[] = [];
  const logs: ProxyLogEntry[] = [];

  for (const [baseUrlVar, target] of targetByBaseUrlVar) {
    const server = createProxyServer(target, logs);
    const port = await listen(server);
    servers.push(server);
    listeners.push({ baseUrlVar, port });
  }

  return {
    listeners,
    getLogs: () => [...logs],
    getLogsForTestCase: (testCaseId: string) => logs.filter(e => e.testCaseId === testCaseId),
    stop: async () => {
      await Promise.all(servers.map(closeServer));
    },
  };
}

/**
 * Extracts a test-case tag from an incoming auth header value.
 * The tag is embedded by `stampProxyTag()` as `proxy:<id>` and may
 * arrive with a prefix (e.g. `Bearer proxy:TC-001` or just `proxy:TC-001`).
 */
function extractProxyTag(headerValue: string | undefined): string | undefined {
  if (!headerValue) return undefined;
  const match = headerValue.match(/proxy:(.+)/);
  return match ? match[1] : undefined;
}

function createProxyServer(target: ProxyTarget, logs: ProxyLogEntry[]): Server {
  const middleware = createProxyMiddleware({
    target: target.targetBaseUrl,
    changeOrigin: true,
    on: {
      proxyReq: (proxyReq, req) => {
        // Extract test-case tag from incoming auth headers before overwriting
        const authHeaderLower = target.headerName.toLowerCase();
        const incomingAuth = req.headers['authorization']
          ?? req.headers[authHeaderLower];
        const headerStr = Array.isArray(incomingAuth) ? incomingAuth[0] : incomingAuth;
        (req as any).__testCaseId = extractProxyTag(headerStr);
        (req as any).__startTime = Date.now();

        // Capture request body passively for logging
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          (req as any).__requestBody = chunks.length > 0
            ? Buffer.concat(chunks).toString('utf8')
            : undefined;
        });

        // Strip dummy auth headers, inject real secret
        proxyReq.removeHeader('authorization');
        proxyReq.removeHeader(target.headerName);
        const authValue = target.headerPrefix
          ? `${target.headerPrefix}${target.headerValue}`
          : target.headerValue;
        proxyReq.setHeader(target.headerName, authValue);
      },
      proxyRes: (proxyRes, req) => {
        // Capture response body passively (streaming preserved — no selfHandleResponse)
        const chunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on('end', () => {
          let responseBody: string | undefined;
          if (chunks.length > 0) {
            const raw = Buffer.concat(chunks);
            responseBody = decompressForLog(raw, proxyRes.headers['content-encoding']);
          }
          logs.push({
            timestamp: new Date().toISOString(),
            method: req.method ?? 'GET',
            url: req.url ?? '/',
            upstreamUrl: `${target.targetBaseUrl}${req.url}`,
            status: proxyRes.statusCode ?? 0,
            durationMs: Date.now() - ((req as any).__startTime ?? 0),
            requestBody: (req as any).__requestBody,
            responseBody,
            testCaseId: (req as any).__testCaseId,
          });
        });
      },
      error: (err, req, res) => {
        const serverRes = res as ServerResponse;
        if (!serverRes.headersSent) {
          serverRes.writeHead(502);
          serverRes.end(`Auth proxy upstream error: ${err.message}`);
        }
        logs.push({
          timestamp: new Date().toISOString(),
          method: (req as IncomingMessage).method ?? 'GET',
          url: (req as IncomingMessage).url ?? '/',
          upstreamUrl: `${target.targetBaseUrl}${(req as IncomingMessage).url}`,
          status: 502,
          durationMs: Date.now() - ((req as any).__startTime ?? 0),
          testCaseId: (req as any).__testCaseId,
          error: err.message,
        });
      },
    },
  });

  return createServer(middleware);
}

/** Decompress a response buffer for logging only. Falls back to raw UTF-8 on error. */
function decompressForLog(buf: Buffer, encoding: string | undefined): string {
  try {
    switch (encoding) {
      case 'gzip':
        return gunzipSync(buf).toString('utf8');
      case 'br':
        return brotliDecompressSync(buf).toString('utf8');
      case 'deflate':
        return inflateSync(buf).toString('utf8');
      default:
        return buf.toString('utf8');
    }
  } catch {
    // If decompression fails (e.g. partial stream), return raw as UTF-8
    return buf.toString('utf8');
  }
}

function listen(server: Server): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', () => {
      server.removeListener('error', reject);
      const addr = server.address();
      resolve(typeof addr === 'object' && addr !== null ? addr.port : 0);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
