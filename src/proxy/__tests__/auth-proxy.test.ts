import { describe, it, expect, afterEach } from 'vitest';
import { startAuthProxy, type AuthProxyHandle } from '../auth-proxy.js';
import type { ProxyTarget } from '../env-rewriter.js';
import { createServer, type Server } from 'node:http';

// Helper: create a mock upstream server that echoes back request info
function createMockUpstream(): Promise<{ server: Server; port: number; requests: Array<{ method: string; url: string; headers: Record<string, string | undefined>; body: string }> }> {
  const requests: Array<{ method: string; url: string; headers: Record<string, string | undefined>; body: string }> = [];

  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks).toString();

      requests.push({
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        headers: req.headers as Record<string, string | undefined>,
        body,
      });

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      resolve({ server, port, requests });
    });
  });
}

let proxy: AuthProxyHandle | undefined;
const upstreams: Array<{ server: Server }> = [];

afterEach(async () => {
  await proxy?.stop();
  proxy = undefined;
  await Promise.all(
    upstreams.map((u) => new Promise<void>((resolve, reject) => {
      u.server.close((err) => err ? reject(err) : resolve());
    })),
  );
  upstreams.length = 0;
});

describe('startAuthProxy', () => {
  it('throws when no targets are provided', async () => {
    await expect(startAuthProxy([], new Map())).rejects.toThrow('At least one proxy target');
  });

  it('starts one listener per unique baseUrlVar', async () => {
    const up = await createMockUpstream();
    upstreams.push(up);

    const targets: ProxyTarget[] = [
      {
        envVar: 'ANTHROPIC_API_KEY',
        targetBaseUrl: `http://127.0.0.1:${up.port}`,
        headerName: 'x-api-key',
        headerValue: 'sk-ant',
      },
      {
        envVar: 'OPENAI_API_KEY',
        targetBaseUrl: `http://127.0.0.1:${up.port}`,
        headerName: 'Authorization',
        headerValue: 'sk-oai',
        headerPrefix: 'Bearer ',
      },
    ];
    const baseUrlVarMap = new Map([
      ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL'],
      ['OPENAI_API_KEY', 'OPENAI_BASE_URL'],
    ]);

    proxy = await startAuthProxy(targets, baseUrlVarMap);
    expect(proxy.listeners).toHaveLength(2);
    expect(proxy.listeners.map((l) => l.baseUrlVar).sort()).toEqual([
      'ANTHROPIC_BASE_URL',
      'OPENAI_BASE_URL',
    ]);
    // Each listener should have its own port
    expect(proxy.listeners[0].port).not.toBe(proxy.listeners[1].port);
  });

  it('de-duplicates targets sharing the same baseUrlVar (last wins)', async () => {
    const up = await createMockUpstream();
    upstreams.push(up);

    const targets: ProxyTarget[] = [
      {
        envVar: 'ANTHROPIC_API_KEY',
        targetBaseUrl: `http://127.0.0.1:${up.port}`,
        headerName: 'x-api-key',
        headerValue: 'key-from-api-key',
      },
      {
        envVar: 'CLAUDE_CODE_OAUTH_TOKEN',
        targetBaseUrl: `http://127.0.0.1:${up.port}`,
        headerName: 'Authorization',
        headerValue: 'oauth-token',
        headerPrefix: 'Bearer ',
      },
    ];
    const baseUrlVarMap = new Map([
      ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL'],
      ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_BASE_URL'],
    ]);

    proxy = await startAuthProxy(targets, baseUrlVarMap);
    // Only one listener since both map to ANTHROPIC_BASE_URL
    expect(proxy.listeners).toHaveLength(1);
    expect(proxy.listeners[0].baseUrlVar).toBe('ANTHROPIC_BASE_URL');

    // The last target (CLAUDE_CODE_OAUTH_TOKEN) should win
    await fetch(`http://127.0.0.1:${proxy.listeners[0].port}/v1/messages`, {
      method: 'POST',
      body: '{}',
    });

    expect(up.requests[0].headers['authorization']).toBe('Bearer oauth-token');
  });

  it('injects auth header and forwards to upstream', async () => {
    const up = await createMockUpstream();
    upstreams.push(up);

    const targets: ProxyTarget[] = [{
      envVar: 'ANTHROPIC_API_KEY',
      targetBaseUrl: `http://127.0.0.1:${up.port}`,
      headerName: 'x-api-key',
      headerValue: 'sk-secret-key',
    }];
    const baseUrlVarMap = new Map([['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL']]);

    proxy = await startAuthProxy(targets, baseUrlVarMap);

    const res = await fetch(`http://127.0.0.1:${proxy.listeners[0].port}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello' }),
    });

    expect(res.status).toBe(200);
    expect(up.requests).toHaveLength(1);
    expect(up.requests[0].url).toBe('/v1/messages');
    expect(up.requests[0].method).toBe('POST');
    expect(up.requests[0].headers['x-api-key']).toBe('sk-secret-key');
    expect(up.requests[0].body).toBe('{"prompt":"hello"}');
  });

  it('returns 502 when upstream is unreachable', async () => {
    const targets: ProxyTarget[] = [{
      envVar: 'ANTHROPIC_API_KEY',
      targetBaseUrl: 'http://127.0.0.1:1',
      headerName: 'x-api-key',
      headerValue: 'key',
    }];
    const baseUrlVarMap = new Map([['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL']]);

    proxy = await startAuthProxy(targets, baseUrlVarMap);

    const res = await fetch(`http://127.0.0.1:${proxy.listeners[0].port}/test`);
    expect(res.status).toBe(502);
  });

  it('stops all listeners cleanly', async () => {
    const up = await createMockUpstream();
    upstreams.push(up);

    const targets: ProxyTarget[] = [{
      envVar: 'ANTHROPIC_API_KEY',
      targetBaseUrl: `http://127.0.0.1:${up.port}`,
      headerName: 'x-api-key',
      headerValue: 'key',
    }];
    const baseUrlVarMap = new Map([['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL']]);

    proxy = await startAuthProxy(targets, baseUrlVarMap);
    const port = proxy.listeners[0].port;
    await proxy.stop();
    proxy = undefined;

    await expect(
      fetch(`http://127.0.0.1:${port}/test`).then((r) => r.text()),
    ).rejects.toThrow();
  });
});
