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
        envVar: 'GOOGLE_API_KEY',
        targetBaseUrl: `http://127.0.0.1:${up.port}`,
        headerName: 'x-goog-api-key',
        headerValue: 'goog-key-first',
      },
      {
        envVar: 'GEMINI_API_KEY',
        targetBaseUrl: `http://127.0.0.1:${up.port}`,
        headerName: 'x-goog-api-key',
        headerValue: 'gem-key-last',
      },
    ];
    const baseUrlVarMap = new Map([
      ['GOOGLE_API_KEY', 'GOOGLE_GEMINI_BASE_URL'],
      ['GEMINI_API_KEY', 'GOOGLE_GEMINI_BASE_URL'],
    ]);

    proxy = await startAuthProxy(targets, baseUrlVarMap);
    // Only one listener since both map to GOOGLE_GEMINI_BASE_URL
    expect(proxy.listeners).toHaveLength(1);
    expect(proxy.listeners[0].baseUrlVar).toBe('GOOGLE_GEMINI_BASE_URL');

    // The last target (GEMINI_API_KEY) should win
    await fetch(`http://127.0.0.1:${proxy.listeners[0].port}/v1/models`, {
      method: 'GET',
    });

    expect(up.requests[0].headers['x-goog-api-key']).toBe('gem-key-last');
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

  it('records request log entries via getLogs()', async () => {
    const up = await createMockUpstream();
    upstreams.push(up);

    const targets: ProxyTarget[] = [{
      envVar: 'ANTHROPIC_API_KEY',
      targetBaseUrl: `http://127.0.0.1:${up.port}`,
      headerName: 'x-api-key',
      headerValue: 'sk-key',
    }];
    const baseUrlVarMap = new Map([['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL']]);

    proxy = await startAuthProxy(targets, baseUrlVarMap);
    expect(proxy.getLogs()).toHaveLength(0);

    await fetch(`http://127.0.0.1:${proxy.listeners[0].port}/v1/messages`, {
      method: 'POST',
      body: '{}',
    });

    const logs = proxy.getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].method).toBe('POST');
    expect(logs[0].url).toBe('/v1/messages');
    expect(logs[0].status).toBe(200);
    expect(logs[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(logs[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(logs[0].requestBody).toBe('{}');
    expect(logs[0].responseBody).toBe('{"ok":true}');
    expect(logs[0].error).toBeUndefined();
  });

  it('records error log entries for failed upstream', async () => {
    const targets: ProxyTarget[] = [{
      envVar: 'ANTHROPIC_API_KEY',
      targetBaseUrl: 'http://127.0.0.1:1',
      headerName: 'x-api-key',
      headerValue: 'key',
    }];
    const baseUrlVarMap = new Map([['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL']]);

    proxy = await startAuthProxy(targets, baseUrlVarMap);

    await fetch(`http://127.0.0.1:${proxy.listeners[0].port}/test`);

    const logs = proxy.getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe(502);
    expect(logs[0].error).toBeDefined();
  });

  it('extracts test case tag from incoming auth header', async () => {
    const up = await createMockUpstream();
    upstreams.push(up);

    const targets: ProxyTarget[] = [{
      envVar: 'OPENAI_API_KEY',
      targetBaseUrl: `http://127.0.0.1:${up.port}`,
      headerName: 'Authorization',
      headerValue: 'sk-real-openai-key',
      headerPrefix: 'Bearer ',
    }];
    const baseUrlVarMap = new Map([['OPENAI_API_KEY', 'OPENAI_BASE_URL']]);

    proxy = await startAuthProxy(targets, baseUrlVarMap);

    // Send request with tagged dummy token (as the CLI would)
    await fetch(`http://127.0.0.1:${proxy.listeners[0].port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer proxy:TC-001' },
      body: '{}',
    });

    // Upstream should get the real token, not the tag
    expect(up.requests[0].headers['authorization']).toBe('Bearer sk-real-openai-key');

    // Log should have the test case ID extracted from the tag
    const logs = proxy.getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].testCaseId).toBe('TC-001');
  });

  it('getLogsForTestCase filters by test case ID', async () => {
    const up = await createMockUpstream();
    upstreams.push(up);

    const targets: ProxyTarget[] = [{
      envVar: 'OPENAI_API_KEY',
      targetBaseUrl: `http://127.0.0.1:${up.port}`,
      headerName: 'Authorization',
      headerValue: 'token',
      headerPrefix: 'Bearer ',
    }];
    const baseUrlVarMap = new Map([['OPENAI_API_KEY', 'OPENAI_BASE_URL']]);

    proxy = await startAuthProxy(targets, baseUrlVarMap);

    // Two requests from different test cases
    await fetch(`http://127.0.0.1:${proxy.listeners[0].port}/v1/messages`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer proxy:TC-001' },
      body: '{}',
    });
    await fetch(`http://127.0.0.1:${proxy.listeners[0].port}/v1/messages`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer proxy:TC-002' },
      body: '{}',
    });

    expect(proxy.getLogs()).toHaveLength(2);
    expect(proxy.getLogsForTestCase('TC-001')).toHaveLength(1);
    expect(proxy.getLogsForTestCase('TC-002')).toHaveLength(1);
    expect(proxy.getLogsForTestCase('TC-003')).toHaveLength(0);
  });

  it('logs have no testCaseId when no proxy tag is present', async () => {
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

    await fetch(`http://127.0.0.1:${proxy.listeners[0].port}/test`, {
      headers: { 'x-api-key': 'some-plain-key' },
    });

    const logs = proxy.getLogs();
    expect(logs[0].testCaseId).toBeUndefined();
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
