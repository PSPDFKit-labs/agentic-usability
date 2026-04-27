import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isHostAllowed, createEgressLogger, createEgressLockdownLogger } from '../egress-logger.js';
import type { EgressLoggerHandle } from '../egress-logger.js';

// ── isHostAllowed tests ──────────────────────────────────────────────────────

describe('isHostAllowed', () => {
  const allowlist = [
    'api.anthropic.com',
    '*.github.com',
    'registry.npmjs.org',
    '*.googleapis.com',
  ];

  it('allows exact match', () => {
    expect(isHostAllowed('api.anthropic.com', allowlist)).toBe(true);
    expect(isHostAllowed('registry.npmjs.org', allowlist)).toBe(true);
  });

  it('allows wildcard suffix match', () => {
    expect(isHostAllowed('raw.github.com', allowlist)).toBe(true);
    expect(isHostAllowed('api.github.com', allowlist)).toBe(true);
    expect(isHostAllowed('storage.googleapis.com', allowlist)).toBe(true);
  });

  it('allows bare domain for wildcard pattern (*.github.com matches github.com)', () => {
    expect(isHostAllowed('github.com', allowlist)).toBe(true);
  });

  it('rejects hosts not in the allowlist', () => {
    expect(isHostAllowed('evil.com', allowlist)).toBe(false);
    expect(isHostAllowed('pastebin.com', allowlist)).toBe(false);
  });

  it('does not match partial domain names', () => {
    expect(isHostAllowed('notgithub.com', allowlist)).toBe(false);
  });

  it('returns false for empty allowlist', () => {
    expect(isHostAllowed('anything.com', [])).toBe(false);
  });
});

// ── createEgressLogger + createEgressLockdownLogger tests ────────────────────

let capturedHooks: {
  onRequest?: (request: any, ctx: any) => Promise<any>;
  onResponse?: (response: any, request: any, ctx: any) => Promise<any>;
};

const mockHandle = {
  done: Promise.resolve(),
  stop: vi.fn().mockResolvedValue(undefined),
  stopped: false,
};

vi.mock('microsandbox/egress-intercept', () => ({
  egressIntercept: vi.fn((_sandbox: any, hooks: any) => {
    capturedHooks = hooks;
    return Promise.resolve({ ...mockHandle });
  }),
  EgressInterceptHandle: class {},
}));

function makeRequest(method = 'GET', uri = '/api/v1/test') {
  return {
    method,
    uri,
    headers: [['Host', 'api.anthropic.com']],
    body: undefined,
  };
}

function makeCtx(sni: string, connectionId = 1): any {
  return {
    sni,
    dst: `${sni}:443`,
    connectionId,
    timestampMs: Date.now(),
  };
}

function makeResponse(status = 200): any {
  return {
    status,
    headers: [['Content-Type', 'application/json']],
    body: undefined,
  };
}

describe('createEgressLogger', () => {
  let handle: EgressLoggerHandle;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedHooks = {};
    handle = createEgressLogger({} as any);
  });

  it('starts with empty logs', () => {
    expect(handle.getLogs()).toEqual([]);
  });

  it('logs request+response pairs in pass-through mode', async () => {
    const req = makeRequest();
    const ctx = makeCtx('api.anthropic.com', 42);

    const result = await capturedHooks.onRequest!(req, ctx);
    expect(result).toBeUndefined();

    const resp = makeResponse(200);
    await capturedHooks.onResponse!(resp, req, { ...ctx, timestampMs: ctx.timestampMs + 100 });

    const logs = handle.getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].method).toBe('GET');
    expect(logs[0].sni).toBe('api.anthropic.com');
    expect(logs[0].responseStatus).toBe(200);
    expect(logs[0].blocked).toBeUndefined();
  });
});

describe('createEgressLockdownLogger', () => {
  let handle: EgressLoggerHandle;

  beforeEach(async () => {
    vi.clearAllMocks();
    capturedHooks = {};
    handle = await createEgressLockdownLogger({} as any, ['api.anthropic.com']);
  });

  it('passes through requests to allowed hosts', async () => {
    const req = makeRequest();
    const ctx = makeCtx('api.anthropic.com');
    const result = await capturedHooks.onRequest!(req, ctx);
    expect(result).toBeUndefined();
  });

  it('blocks requests to disallowed hosts by throwing', async () => {
    const req = makeRequest();
    const ctx = makeCtx('evil.com');
    await expect(capturedHooks.onRequest!(req, ctx)).rejects.toThrow(/not in the judge network allowlist/);
  });

  it('logs blocked requests with blocked: true', async () => {
    const req = makeRequest('POST', '/upload');
    const ctx = makeCtx('evil.com', 99);
    await capturedHooks.onRequest!(req, ctx).catch(() => {});

    const logs = handle.getLogs();
    const blocked = logs.filter((l) => l.blocked);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].sni).toBe('evil.com');
    expect(blocked[0].method).toBe('POST');
  });

  it('supports wildcard patterns', async () => {
    capturedHooks = {};
    handle = await createEgressLockdownLogger({} as any, ['*.github.com']);

    const req = makeRequest();

    const allowed = await capturedHooks.onRequest!(req, makeCtx('raw.github.com'));
    expect(allowed).toBeUndefined();

    await expect(
      capturedHooks.onRequest!(req, makeCtx('evil.com')),
    ).rejects.toThrow();
  });

  it('logs allowed request+response pairs', async () => {
    const req = makeRequest();
    const ctx = makeCtx('api.anthropic.com', 2);
    await capturedHooks.onRequest!(req, ctx);
    await capturedHooks.onResponse!(makeResponse(), req, { ...ctx, timestampMs: ctx.timestampMs + 50 });

    const logs = handle.getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].sni).toBe('api.anthropic.com');
    expect(logs[0].blocked).toBeUndefined();
    expect(logs[0].responseStatus).toBe(200);
  });
});