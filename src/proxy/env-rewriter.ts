/**
 * Rewrites sandbox env vars so that API key secrets are extracted and replaced
 * with *_BASE_URL vars pointing to a local auth proxy.
 *
 * This prevents secrets from ever entering the sandbox environment — agent-generated
 * code (e.g. `printenv`) cannot leak them.
 *
 * For Anthropic secrets (ANTHROPIC_API_KEY), the proxy
 * acts as an LLM gateway. Claude Code recognises ANTHROPIC_AUTH_TOKEN +
 * ANTHROPIC_BASE_URL as a gateway configuration (auth precedence #2), so we
 * emit those instead of the original secret var.
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
  /**
   * Env var name + dummy value to inject into cleanEnv so the CLI considers
   * itself authenticated. For Anthropic secrets this is ANTHROPIC_AUTH_TOKEN
   * (gateway auth). For others it's the original key with a dummy value.
   */
  passThrough: { key: string; value: string };
}

const KNOWN_SECRETS: Record<string, SecretMapping> = {
  ANTHROPIC_API_KEY: {
    baseUrlVar: 'ANTHROPIC_BASE_URL',
    targetBaseUrl: 'https://api.anthropic.com',
    headerName: 'x-api-key',
    passThrough: { key: 'ANTHROPIC_AUTH_TOKEN', value: 'proxy-managed' },
  },
  OPENAI_API_KEY: {
    baseUrlVar: 'OPENAI_BASE_URL',
    targetBaseUrl: 'https://api.openai.com',
    headerName: 'Authorization',
    headerPrefix: 'Bearer ',
    passThrough: { key: 'OPENAI_API_KEY', value: 'proxy-managed' },
  },
  GOOGLE_API_KEY: {
    baseUrlVar: 'GOOGLE_GEMINI_BASE_URL',
    targetBaseUrl: 'https://generativelanguage.googleapis.com',
    headerName: 'x-goog-api-key',
    passThrough: { key: 'GOOGLE_API_KEY', value: 'proxy-managed' },
  },
  GEMINI_API_KEY: {
    baseUrlVar: 'GOOGLE_GEMINI_BASE_URL',
    targetBaseUrl: 'https://generativelanguage.googleapis.com',
    headerName: 'x-goog-api-key',
    passThrough: { key: 'GEMINI_API_KEY', value: 'proxy-managed' },
  },
};

const SECRET_KEY_PATTERN = /_(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)S?$/i;
const SECRET_VALUE_PREFIXES = ['sk-', 'ghp_', 'gho_', 'AIza', 'AKIA', 'op://'];

function looksLikeSecret(key: string, value: string): boolean {
  if (SECRET_KEY_PATTERN.test(key)) return true;
  return SECRET_VALUE_PREFIXES.some((prefix) => value.startsWith(prefix));
}

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
 * For each extracted secret, a gateway-compatible passthrough var is injected
 * into cleanEnv (e.g. ANTHROPIC_AUTH_TOKEN=proxy-managed) so the CLI
 * considers itself authenticated and routes requests through the proxy.
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
      // Inject gateway-compatible passthrough (e.g. ANTHROPIC_AUTH_TOKEN)
      cleanEnv[mapping.passThrough.key] = mapping.passThrough.value;
    } else {
      // Warn if the var looks like a secret but isn't proxied
      if (looksLikeSecret(key, value)) {
        console.warn(
          `\x1b[33m⚠ sandbox.env.${key} looks like a secret but is not proxied — it will enter the sandbox in plaintext and may be visible to agent code (e.g. via printenv). Consider removing it from sandbox.env if the agent does not need it or rotate the keys after usage.\x1b[0m`,
        );
      }
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

/**
 * Stamps a test-case tag onto all proxy-managed passthrough values in the env.
 * The tag travels through the CLI → proxy as a dummy credential, allowing the
 * proxy to correlate log entries with specific test cases.
 */
export function stampProxyTag(
  env: Record<string, string>,
  tag: string,
): Record<string, string> {
  const result = { ...env };
  for (const [key, value] of Object.entries(result)) {
    if (value === 'proxy-managed') {
      result[key] = `proxy:${tag}`;
    }
  }
  return result;
}
