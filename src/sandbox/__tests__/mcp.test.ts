import { describe, it, expect } from 'vitest';
import { MCP_ROOT_PLACEHOLDER, substituteMcpRoot } from '../mcp.js';

describe('substituteMcpRoot', () => {
  it('replaces every occurrence of the placeholder in each arg', () => {
    expect(substituteMcpRoot(
      ['${MCP_ROOT}/index.js', '--config', '${MCP_ROOT}/config.json'],
      '/sandbox/.mcp-servers/mine',
    )).toEqual([
      '/sandbox/.mcp-servers/mine/index.js',
      '--config',
      '/sandbox/.mcp-servers/mine/config.json',
    ]);
  });

  it('leaves args without the placeholder untouched', () => {
    expect(substituteMcpRoot(['-y', 'server-filesystem'], '/anywhere')).toEqual(['-y', 'server-filesystem']);
  });

  it('replaces multiple placeholders within a single arg', () => {
    expect(substituteMcpRoot(['${MCP_ROOT}/a:${MCP_ROOT}/b'], '/x')).toEqual(['/x/a:/x/b']);
  });

  it('exports the placeholder literal that validators and adapters can share', () => {
    expect(MCP_ROOT_PLACEHOLDER).toBe('${MCP_ROOT}');
  });
});
