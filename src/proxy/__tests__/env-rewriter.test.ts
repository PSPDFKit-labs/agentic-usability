import { describe, it, expect } from 'vitest';
import { rewriteEnv, applyProxyUrls } from '../env-rewriter.js';

describe('rewriteEnv', () => {
  it('returns empty result for undefined env', () => {
    const result = rewriteEnv(undefined);
    expect(result.proxyTargets).toEqual([]);
    expect(result.baseUrlVarMap.size).toBe(0);
    expect(result.cleanEnv).toEqual({});
  });

  it('returns empty result for empty env', () => {
    const result = rewriteEnv({});
    expect(result.proxyTargets).toEqual([]);
    expect(result.cleanEnv).toEqual({});
  });

  it('passes through non-secret vars unchanged', () => {
    const result = rewriteEnv({ NODE_ENV: 'test', DEBUG: '1' });
    expect(result.proxyTargets).toEqual([]);
    expect(result.cleanEnv).toEqual({ NODE_ENV: 'test', DEBUG: '1' });
  });

  it('extracts ANTHROPIC_API_KEY into proxy target', () => {
    const result = rewriteEnv({ ANTHROPIC_API_KEY: 'sk-secret' });

    expect(result.proxyTargets).toHaveLength(1);
    expect(result.proxyTargets[0]).toEqual({
      envVar: 'ANTHROPIC_API_KEY',
      targetBaseUrl: 'https://api.anthropic.com',
      headerName: 'x-api-key',
      headerValue: 'sk-secret',
      headerPrefix: undefined,
    });
    expect(result.baseUrlVarMap.get('ANTHROPIC_API_KEY')).toBe('ANTHROPIC_BASE_URL');
    // Secret must not appear in cleanEnv
    expect(result.cleanEnv).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(result.cleanEnv).not.toHaveProperty('ANTHROPIC_BASE_URL');
  });

  it('extracts CLAUDE_CODE_OAUTH_TOKEN with Bearer prefix', () => {
    const result = rewriteEnv({ CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token' });

    expect(result.proxyTargets[0]).toEqual({
      envVar: 'CLAUDE_CODE_OAUTH_TOKEN',
      targetBaseUrl: 'https://api.anthropic.com',
      headerName: 'Authorization',
      headerValue: 'oauth-token',
      headerPrefix: 'Bearer ',
    });
    expect(result.baseUrlVarMap.get('CLAUDE_CODE_OAUTH_TOKEN')).toBe('ANTHROPIC_BASE_URL');
    expect(result.cleanEnv).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN');
  });

  it('extracts OPENAI_API_KEY', () => {
    const result = rewriteEnv({ OPENAI_API_KEY: 'sk-openai' });

    expect(result.proxyTargets[0]).toMatchObject({
      envVar: 'OPENAI_API_KEY',
      targetBaseUrl: 'https://api.openai.com',
      headerPrefix: 'Bearer ',
    });
    expect(result.baseUrlVarMap.get('OPENAI_API_KEY')).toBe('OPENAI_BASE_URL');
    expect(result.cleanEnv).not.toHaveProperty('OPENAI_API_KEY');
  });

  it('extracts GOOGLE_API_KEY', () => {
    const result = rewriteEnv({ GOOGLE_API_KEY: 'goog-key' });

    expect(result.proxyTargets[0]).toMatchObject({
      envVar: 'GOOGLE_API_KEY',
      headerName: 'x-goog-api-key',
    });
    expect(result.baseUrlVarMap.get('GOOGLE_API_KEY')).toBe('GOOGLE_GEMINI_BASE_URL');
    expect(result.cleanEnv).not.toHaveProperty('GOOGLE_API_KEY');
  });

  it('extracts GEMINI_API_KEY', () => {
    const result = rewriteEnv({ GEMINI_API_KEY: 'gem-key' });
    expect(result.baseUrlVarMap.get('GEMINI_API_KEY')).toBe('GOOGLE_GEMINI_BASE_URL');
    expect(result.cleanEnv).not.toHaveProperty('GEMINI_API_KEY');
  });

  it('no secret value leaks into cleanEnv for any known secret', () => {
    const secrets = {
      ANTHROPIC_API_KEY: 'sk-ant-secret',
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-secret',
      OPENAI_API_KEY: 'sk-oai-secret',
      GOOGLE_API_KEY: 'goog-secret',
      GEMINI_API_KEY: 'gem-secret',
    };
    const result = rewriteEnv({ ...secrets, SAFE_VAR: 'public' });

    // No secret env var name should appear as a key in cleanEnv
    for (const secretKey of Object.keys(secrets)) {
      expect(result.cleanEnv).not.toHaveProperty(secretKey);
    }
    // No secret value should appear anywhere in cleanEnv values
    const allCleanValues = Object.values(result.cleanEnv).join(' ');
    for (const secretValue of Object.values(secrets)) {
      expect(allCleanValues).not.toContain(secretValue);
    }
    // Non-secret var must survive
    expect(result.cleanEnv).toHaveProperty('SAFE_VAR', 'public');
  });

  it('handles mixed secret and non-secret vars', () => {
    const result = rewriteEnv({
      ANTHROPIC_API_KEY: 'sk-secret',
      NODE_ENV: 'production',
      DEBUG: '1',
    });

    expect(result.proxyTargets).toHaveLength(1);
    expect(result.cleanEnv).toEqual({ NODE_ENV: 'production', DEBUG: '1' });
  });

  it('handles multiple secrets targeting different upstreams', () => {
    const result = rewriteEnv({
      ANTHROPIC_API_KEY: 'sk-ant',
      OPENAI_API_KEY: 'sk-oai',
    });

    expect(result.proxyTargets).toHaveLength(2);
    expect(result.baseUrlVarMap.size).toBe(2);
  });
});

describe('applyProxyUrls', () => {
  it('adds BASE_URL entries for each listener', () => {
    const cleanEnv = { NODE_ENV: 'test' };
    const listeners = [
      { baseUrlVar: 'ANTHROPIC_BASE_URL', port: 12345 },
      { baseUrlVar: 'OPENAI_BASE_URL', port: 12346 },
    ];

    const result = applyProxyUrls(cleanEnv, listeners, 'host.docker.internal');

    expect(result).toEqual({
      NODE_ENV: 'test',
      ANTHROPIC_BASE_URL: 'http://host.docker.internal:12345',
      OPENAI_BASE_URL: 'http://host.docker.internal:12346',
    });
  });

  it('does not mutate the original cleanEnv', () => {
    const cleanEnv = { NODE_ENV: 'test' };
    applyProxyUrls(cleanEnv, [{ baseUrlVar: 'ANTHROPIC_BASE_URL', port: 1 }], 'localhost');
    expect(cleanEnv).toEqual({ NODE_ENV: 'test' });
  });

  it('returns cleanEnv unchanged when no listeners', () => {
    const cleanEnv = { FOO: 'bar' };
    const result = applyProxyUrls(cleanEnv, [], 'localhost');
    expect(result).toEqual({ FOO: 'bar' });
  });
});
