/**
 * Rewrites sandbox env vars so that API key secrets are extracted and replaced
 * with *_BASE_URL vars pointing to a local auth proxy.
 *
 * This prevents secrets from ever entering the sandbox environment — agent-generated
 * code (e.g. `printenv`) cannot leak them.
 */

export interface ProxyTarget {
  /** Original env var name (e.g. "ANTHROPIC_API_KEY") */
  envVar: string;
  /** Upstream API base URL (e.g. "https://api.anthropic.com") */
  targetBaseUrl: string;
  /** HTTP header name to inject (e.g. "x-api-key") */
  headerName: string;
  /** The secret value to inject */
  headerValue: string;
  /** Optional prefix before the value (e.g. "Bearer ") */
  headerPrefix?: string;
}

interface SecretMapping {
  baseUrlVar: string;
  targetBaseUrl: string;
  headerName: string;
  headerPrefix?: string;
}

const KNOWN_SECRETS: Record<string, SecretMapping> = {
  ANTHROPIC_API_KEY: {
    baseUrlVar: 'ANTHROPIC_BASE_URL',
    targetBaseUrl: 'https://api.anthropic.com',
    headerName: 'x-api-key',
  },
  CLAUDE_CODE_OAUTH_TOKEN: {
    baseUrlVar: 'ANTHROPIC_BASE_URL',
    targetBaseUrl: 'https://api.anthropic.com',
    headerName: 'Authorization',
    headerPrefix: 'Bearer ',
  },
  OPENAI_API_KEY: {
    baseUrlVar: 'OPENAI_BASE_URL',
    targetBaseUrl: 'https://api.openai.com',
    headerName: 'Authorization',
    headerPrefix: 'Bearer ',
  },
  GOOGLE_API_KEY: {
    baseUrlVar: 'GOOGLE_GEMINI_BASE_URL',
    targetBaseUrl: 'https://generativelanguage.googleapis.com',
    headerName: 'x-goog-api-key',
  },
  GEMINI_API_KEY: {
    baseUrlVar: 'GOOGLE_GEMINI_BASE_URL',
    targetBaseUrl: 'https://generativelanguage.googleapis.com',
    headerName: 'x-goog-api-key',
  },
};

export interface RewriteResult {
  /** Proxy targets extracted from secret env vars */
  proxyTargets: ProxyTarget[];
  /** Maps each target's envVar → its baseUrlVar (used by startAuthProxy to group listeners) */
  baseUrlVarMap: Map<string, string>;
  /** Clean env with secrets removed (BASE_URL vars are NOT set yet — call applyProxyUrls after proxy starts) */
  cleanEnv: Record<string, string>;
}

/**
 * Extracts known secret env vars from `sandboxEnv`, returning proxy target
 * configs and a clean env map with secrets removed.
 *
 * BASE_URL vars are NOT populated here because we don't know the proxy ports yet.
 * After starting the proxy, call `applyProxyUrls()` to fill them in.
 */
export function rewriteEnv(
  sandboxEnv: Record<string, string> | undefined,
): RewriteResult {
  if (!sandboxEnv) {
    return { proxyTargets: [], baseUrlVarMap: new Map(), cleanEnv: {} };
  }

  const proxyTargets: ProxyTarget[] = [];
  const baseUrlVarMap = new Map<string, string>();
  const cleanEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries(sandboxEnv)) {
    const mapping = KNOWN_SECRETS[key];
    if (mapping) {
      proxyTargets.push({
        envVar: key,
        targetBaseUrl: mapping.targetBaseUrl,
        headerName: mapping.headerName,
        headerValue: value,
        headerPrefix: mapping.headerPrefix,
      });
      baseUrlVarMap.set(key, mapping.baseUrlVar);
    } else {
      // Pass through non-secret env vars unchanged
      cleanEnv[key] = value;
    }
  }

  return { proxyTargets, baseUrlVarMap, cleanEnv };
}

/**
 * Populates BASE_URL entries in `cleanEnv` using the actual proxy listener ports.
 */
export function applyProxyUrls(
  cleanEnv: Record<string, string>,
  listeners: Array<{ baseUrlVar: string; port: number }>,
  hostAddr: string,
): Record<string, string> {
  const result = { ...cleanEnv };
  for (const { baseUrlVar, port } of listeners) {
    result[baseUrlVar] = `http://${hostAddr}:${port}`;
  }
  return result;
}
