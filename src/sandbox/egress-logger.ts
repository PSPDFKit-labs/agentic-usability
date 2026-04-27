import { egressIntercept, EgressInterceptHandle } from 'microsandbox/egress-intercept';
import type { Sandbox, EgressHttpRequest, EgressHttpResponse } from 'microsandbox';

interface EgressContext {
  sni: string;
  dst: string;
  connectionId: number;
  timestampMs: number;
}

const MAX_BODY_LOG = 512; // characters — keep logs readable across many requests

export interface EgressLogEntry {
  timestamp: string;
  method: string;
  uri: string;
  sni: string;
  connectionId: number;
  requestHeaders: Record<string, string>;
  requestBody?: string;
  responseStatus?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  durationMs?: number;
  blocked?: boolean;
}

interface PendingRequest {
  timestamp: number;
  method: string;
  uri: string;
  sni: string;
  connectionId: number;
  requestHeaders: Record<string, string>;
  requestBody?: string;
}

export interface EgressLoggerHandle {
  getLogs(): EgressLogEntry[];
  getLogsForHost(host: string): EgressLogEntry[];
  done: Promise<void>;
}

/**
 * Check whether a hostname is in the allowed list.
 * Supports exact match and `*.suffix` wildcard patterns.
 */
export function isHostAllowed(sni: string, allowedHosts: string[]): boolean {
  for (const pattern of allowedHosts) {
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1); // e.g. "*.github.com" → ".github.com"
      if (sni === pattern.slice(2) || sni.endsWith(suffix)) return true;
    } else if (sni === pattern) {
      return true;
    }
  }
  return false;
}

function headersToRecord(headers: Array<Array<string>>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of headers) {
    result[key] = value;
  }
  return result;
}

function isBinary(buf: Buffer): boolean {
  const sample = Math.min(buf.length, 512);
  let nonPrintable = 0;
  for (let i = 0; i < sample; i++) {
    const b = buf[i];
    if (b === 0) return true;
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) nonPrintable++;
  }
  return nonPrintable / sample > 0.1;
}

function truncateBody(body: Buffer | undefined): string | undefined {
  if (!body || body.length === 0) return undefined;
  if (isBinary(body)) return `<binary, ${body.length} bytes>`;
  const str = body.toString('utf8', 0, Math.min(body.length, MAX_BODY_LOG));
  if (body.length > MAX_BODY_LOG) return str + `... (truncated, ${body.length} bytes total)`;
  return str;
}

function handleInterceptError(err: unknown, phase: string): void {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg && !msg.includes('EOF') && !msg.includes('closed') && !msg.includes('reset') && !msg.includes('consumed')) {
    console.warn(`[egress] ${phase} interception failed: ${msg}`);
  }
}

/**
 * Build onRequest/onResponse hooks that log traffic and optionally enforce an allowlist.
 */
function buildHooks(
  logs: EgressLogEntry[],
  pending: Map<number, PendingRequest>,
  allowedHosts?: string[],
) {
  return {
    onRequest: async (request: EgressHttpRequest, ctx: EgressContext) => {
      if (allowedHosts && !isHostAllowed(ctx.sni, allowedHosts)) {
        logs.push({
          timestamp: new Date(ctx.timestampMs).toISOString(),
          method: request.method,
          uri: request.uri,
          sni: ctx.sni,
          connectionId: ctx.connectionId,
          requestHeaders: headersToRecord(request.headers),
          requestBody: truncateBody(request.body),
          blocked: true,
        });
        throw new Error(`Blocked: host '${ctx.sni}' is not in the judge network allowlist`);
      }

      pending.set(ctx.connectionId, {
        timestamp: ctx.timestampMs,
        method: request.method,
        uri: request.uri,
        sni: ctx.sni,
        connectionId: ctx.connectionId,
        requestHeaders: headersToRecord(request.headers),
        requestBody: truncateBody(request.body),
      });
      return undefined; // pass through
    },
    onResponse: async (response: EgressHttpResponse, _request: EgressHttpRequest | undefined, ctx: EgressContext) => {
      const req = pending.get(ctx.connectionId);
      if (req) {
        pending.delete(ctx.connectionId);
        logs.push({
          timestamp: new Date(req.timestamp).toISOString(),
          method: req.method,
          uri: req.uri,
          sni: req.sni,
          connectionId: req.connectionId,
          requestHeaders: req.requestHeaders,
          requestBody: req.requestBody,
          responseStatus: response.status,
          responseHeaders: headersToRecord(response.headers),
          responseBody: truncateBody(response.body),
          durationMs: ctx.timestampMs - req.timestamp,
        });
      } else {
        logs.push({
          timestamp: new Date(ctx.timestampMs).toISOString(),
          method: 'UNKNOWN',
          uri: 'UNKNOWN',
          sni: ctx.sni,
          connectionId: ctx.connectionId,
          requestHeaders: {},
          responseStatus: response.status,
          responseHeaders: headersToRecord(response.headers),
          responseBody: truncateBody(response.body),
        });
      }
      return undefined; // pass through
    },
  };
}

function buildHandle(
  logs: EgressLogEntry[],
  handlePromise: Promise<EgressInterceptHandle | undefined>,
): EgressLoggerHandle {
  let handle: EgressInterceptHandle | undefined;
  const ready = handlePromise.then((h) => { handle = h; return h; });
  return {
    getLogs: () => [...logs],
    getLogsForHost: (host: string) => logs.filter((e) => e.sni === host),
    get done() { return handle?.done ?? ready.then(h => h?.done ?? Promise.resolve()); },
  };
}

/**
 * Start pass-through egress interception — logs all outbound HTTP traffic without blocking.
 * Used by the executor stage.
 */
export function createEgressLogger(sandbox: Sandbox): EgressLoggerHandle {
  const logs: EgressLogEntry[] = [];
  const pending = new Map<number, PendingRequest>();

  const handlePromise = egressIntercept(sandbox, buildHooks(logs, pending))
    .catch((err: unknown) => {
      handleInterceptError(err, 'pass-through');
      return undefined;
    });

  return buildHandle(logs, handlePromise);
}

/**
 * Start egress interception with allowlist enforcement — blocks hosts not in the list.
 * Used by the judge stage.
 */
export async function createEgressLockdownLogger(
  sandbox: Sandbox,
  allowedHosts: string[],
): Promise<EgressLoggerHandle> {
  const logs: EgressLogEntry[] = [];
  const pending = new Map<number, PendingRequest>();

  const handlePromise = egressIntercept(sandbox, buildHooks(logs, pending, allowedHosts))
    .catch((err: unknown) => {
      handleInterceptError(err, 'lockdown');
      return undefined;
    });

  return buildHandle(logs, handlePromise);
}