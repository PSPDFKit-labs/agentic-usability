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
import type { ProxyTarget } from './env-rewriter.js';

export interface ProxyListener {
  /** The BASE_URL env var this listener serves (e.g. "ANTHROPIC_BASE_URL") */
  baseUrlVar: string;
  /** Ephemeral port the listener is bound to */
  port: number;
}

export interface AuthProxyHandle {
  /** One listener per unique baseUrlVar */
  listeners: ProxyListener[];
  stop(): Promise<void>;
}

/**
 * Start one HTTP proxy listener per unique upstream (keyed by `baseUrlVar`).
 *
 * When multiple secrets share the same `baseUrlVar` (e.g. both ANTHROPIC_API_KEY
 * and CLAUDE_CODE_OAUTH_TOKEN → ANTHROPIC_BASE_URL), the last target wins.
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

  for (const [baseUrlVar, target] of targetByBaseUrlVar) {
    const server = createProxyServer(target);
    const port = await listen(server);
    servers.push(server);
    listeners.push({ baseUrlVar, port });
  }

  return {
    listeners,
    stop: async () => {
      await Promise.all(servers.map(closeServer));
    },
  };
}

function createProxyServer(target: ProxyTarget): Server {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Build upstream URL
    const upstreamUrl = `${target.targetBaseUrl}${req.url ?? ''}`;

    // Collect request body
    const bodyChunks: Buffer[] = [];
    for await (const chunk of req) {
      bodyChunks.push(chunk as Buffer);
    }
    const body = Buffer.concat(bodyChunks);

    // Build forwarded headers (strip hop-by-hop)
    const forwardHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (key === 'host' || key === 'connection' || key === 'transfer-encoding') continue;
      if (value !== undefined) {
        forwardHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
      }
    }

    // Inject auth header
    const authValue = target.headerPrefix
      ? `${target.headerPrefix}${target.headerValue}`
      : target.headerValue;
    forwardHeaders[target.headerName] = authValue;

    try {
      const upstream = await fetch(upstreamUrl, {
        method: req.method ?? 'GET',
        headers: forwardHeaders,
        body: body.length > 0 ? body : undefined,
        // @ts-expect-error -- Node fetch supports duplex for streaming
        duplex: 'half',
      });

      // Forward status and headers
      const responseHeaders: Record<string, string> = {};
      upstream.headers.forEach((value, key) => {
        if (key === 'transfer-encoding' || key === 'connection') return;
        responseHeaders[key] = value;
      });
      res.writeHead(upstream.status, responseHeaders);

      // Stream the response body
      if (upstream.body) {
        const reader = upstream.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        } finally {
          reader.releaseLock();
        }
      }
      res.end();
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(502);
        res.end(`Auth proxy upstream error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });
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
