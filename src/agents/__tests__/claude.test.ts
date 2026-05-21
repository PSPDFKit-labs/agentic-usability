import { describe, it, expect, vi, beforeEach } from 'vitest';
import { access } from 'node:fs/promises';
import { spawnAgent, spawnInteractive } from '../spawn.js';
import { uploadDirToSandbox } from '../../sandbox/scaffolding.js';
import { uploadMcpServerSources } from '../../sandbox/mcp.js';
import { ClaudeAdapter } from '../claude.js';
import { makeAgentResult } from '../../__tests__/helpers/fixtures.js';
import { makeMockSandboxClient } from '../../__tests__/helpers/mock-sandbox-client.js';

vi.mock('../spawn.js', () => ({
  spawnAgent: vi.fn(),
  spawnInteractive: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
}));

vi.mock('../../sandbox/scaffolding.js', () => ({
  uploadDirToSandbox: vi.fn(),
}));

vi.mock('../../sandbox/mcp.js', () => ({
  uploadMcpServerSources: vi.fn(),
}));

const mockSpawnAgent = vi.mocked(spawnAgent);
const mockSpawnInteractive = vi.mocked(spawnInteractive);
const mockAccess = vi.mocked(access);
const mockUploadDir = vi.mocked(uploadDirToSandbox);
const mockUploadMcpSources = vi.mocked(uploadMcpServerSources);

describe('ClaudeAdapter', () => {
  let adapter: ClaudeAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new ClaudeAdapter({ command: 'claude' });
  });

  describe('run', () => {
    it('returns clean result when adapter extracts structured_output from envelope', async () => {
      const envelope = { structured_output: { key: 'value' } };
      mockSpawnAgent.mockResolvedValue(makeAgentResult({ stdout: JSON.stringify(envelope) }));

      const result = await adapter.run('prompt', { type: 'object' }, '/work');

      expect(mockSpawnAgent).toHaveBeenCalledWith('claude', [
        '--print',
        '--output-format', 'json',
        '--json-schema', JSON.stringify({ type: 'object' }),
      ], { cwd: '/work', env: undefined, stdin: 'prompt' });
      expect(result.stdout).toBe(JSON.stringify({ key: 'value' }));
    });

    it('returns clean result when adapter extracts result field', async () => {
      const envelope = { result: 'text result' };
      mockSpawnAgent.mockResolvedValue(makeAgentResult({ stdout: JSON.stringify(envelope) }));

      const result = await adapter.run('prompt', {}, '/work');
      expect(result.stdout).toBe('text result');
    });

    it('retries when stdout is not valid JSON', async () => {
      mockSpawnAgent
        .mockResolvedValueOnce(makeAgentResult({ stdout: 'not json' }))
        .mockResolvedValueOnce(makeAgentResult({ stdout: JSON.stringify({ structured_output: { ok: true } }) }));

      const result = await adapter.run('prompt', {}, '/work', { retries: 1 });

      expect(mockSpawnAgent).toHaveBeenCalledTimes(2);
      expect(result.stdout).toBe(JSON.stringify({ ok: true }));
    });

    it('returns raw result after exhausting retries', async () => {
      mockSpawnAgent.mockResolvedValue(makeAgentResult({ stdout: 'not json' }));

      const result = await adapter.run('prompt', {}, '/work', { retries: 1 });

      expect(mockSpawnAgent).toHaveBeenCalledTimes(2);
      expect(result.stdout).toBe('not json');
    });
  });

  describe('interactive', () => {
    it('calls spawnInteractive with correct args and workDir', async () => {
      mockSpawnInteractive.mockResolvedValue({ exitCode: 0, durationMs: 5000 });

      const result = await adapter.interactive('do something', '/work');

      expect(mockSpawnInteractive).toHaveBeenCalledWith('claude', [
        'do something',
      ], { cwd: '/work' });
      expect(result).toEqual({ exitCode: 0, durationMs: 5000 });
    });
  });

  describe('sandboxCommand', () => {
    it('returns correct shell string with IS_SANDBOX=1', () => {
      const cmd = adapter.sandboxCommand('do something');
      expect(cmd).toContain('IS_SANDBOX=1 claude --print --dangerously-skip-permissions');
      expect(cmd).toContain("'do something'");
      expect(cmd.startsWith('cd /workspace &&')).toBe(true);
    });

    it('escapes single quotes', () => {
      const cmd = adapter.sandboxCommand("it's a test");
      expect(cmd).toContain("it'\\''s a test");
    });

    it('appends custom args', () => {
      const custom = new ClaudeAdapter({ command: 'claude', args: ['--verbose'] });
      const cmd = custom.sandboxCommand('prompt');
      expect(cmd).toBe("cd /workspace && IS_SANDBOX=1 claude --print --dangerously-skip-permissions --verbose 'prompt'");
    });

    it('includes --json-schema flag when schema is provided', () => {
      const schema = { type: 'object', properties: { score: { type: 'number' } } };
      const cmd = adapter.sandboxCommand('prompt', '/workspace', schema);
      expect(cmd).toContain('--output-format json');
      expect(cmd).toContain('--json-schema');
      expect(cmd).toContain('"type":"object"');
    });

    it('omits schema flags when no schema is provided', () => {
      const cmd = adapter.sandboxCommand('prompt');
      expect(cmd).not.toContain('--json-schema');
      expect(cmd).not.toContain('--output-format json');
    });
  });

  describe('extractResult', () => {
    it('unwraps structured_output from Claude envelope', () => {
      const envelope = JSON.stringify({ structured_output: { score: 95 } });
      expect(adapter.extractResult(envelope)).toBe(JSON.stringify({ score: 95 }));
    });

    it('unwraps result field from Claude envelope', () => {
      const envelope = JSON.stringify({ result: 'text output' });
      expect(adapter.extractResult(envelope)).toBe('text output');
    });

    it('returns raw string when not valid JSON', () => {
      expect(adapter.extractResult('not json')).toBe('not json');
    });
  });

  describe('installCommand', () => {
    it('returns correct npm install command', () => {
      expect(adapter.installCommand).toBe('npm i -g @anthropic-ai/claude-code');
    });
  });

  describe('installPluginsInSandbox', () => {
    it('is a no-op when given an empty plugin list', async () => {
      const client = makeMockSandboxClient();
      await adapter.installPluginsInSandbox(client as any, []);
      expect(client.runCommand).not.toHaveBeenCalled();
      expect(client.uploadFiles).not.toHaveBeenCalled();
    });

    it('throws clearly when a plugin is missing its Claude manifest', async () => {
      mockAccess.mockRejectedValueOnce(new Error('ENOENT'));
      const client = makeMockSandboxClient();
      await expect(adapter.installPluginsInSandbox(client as any, [
        { name: 'broken', hostDir: '/tmp/broken' },
      ])).rejects.toThrow(/\.claude-plugin\/plugin\.json/);
      expect(client.runCommand).not.toHaveBeenCalled();
    });

    it('extracts each plugin into /root/.claude/plugins/<name> and records the paths', async () => {
      mockAccess.mockResolvedValue(undefined);
      const client = makeMockSandboxClient();

      await adapter.installPluginsInSandbox(client as any, [
        { name: 'plugin-a', hostDir: '/tmp/a' },
        { name: 'plugin-b', hostDir: '/tmp/b' },
      ]);

      expect(mockUploadDir).toHaveBeenCalledTimes(2);
      expect(mockUploadDir).toHaveBeenCalledWith(client, '/tmp/a', '/root/.claude/plugins/plugin-a', 'plugin_plugin-a');
      expect(mockUploadDir).toHaveBeenCalledWith(client, '/tmp/b', '/root/.claude/plugins/plugin-b', 'plugin_plugin-b');

      // sandboxCommand should now emit --plugin-dir for each plugin.
      const cmd = adapter.sandboxCommand('do the thing');
      expect(cmd).toContain("--plugin-dir '/root/.claude/plugins/plugin-a'");
      expect(cmd).toContain("--plugin-dir '/root/.claude/plugins/plugin-b'");
    });

    it('sandboxCommand does not include --plugin-dir flags when no plugins have been installed', () => {
      const fresh = new ClaudeAdapter({ command: 'claude' });
      const cmd = fresh.sandboxCommand('do the thing');
      expect(cmd).not.toContain('--plugin-dir');
    });
  });

  describe('installMcpServersInSandbox', () => {
    it('is a no-op when given an empty server list', async () => {
      const client = makeMockSandboxClient();
      await adapter.installMcpServersInSandbox(client as any, []);
      expect(client.runCommand).not.toHaveBeenCalled();
    });

    it('delegates uploads to uploadMcpServerSources and renders its result into mcp-config.json', async () => {
      const client = makeMockSandboxClient();
      client.runCommand.mockResolvedValue({ stdout: '/root', stderr: '', exitCode: 0 });
      mockUploadMcpSources.mockResolvedValue([
        { name: 'mine', command: 'node', args: ['/root/.mcp-servers/mine/server.js', '--flag'] },
        { name: 'fs', command: 'npx', args: ['-y', 'server-filesystem'] },
      ]);

      await adapter.installMcpServersInSandbox(client as any, [
        { kind: 'sourced', name: 'mine', command: 'node', args: ['${MCP_ROOT}/server.js', '--flag'], hostDir: '/tmp/mine' },
        { kind: 'sourceless', name: 'fs', command: 'npx', args: ['-y', 'server-filesystem'] },
      ]);

      // Adapter passes the right mcpRoot + server list to the dedicated MCP upload helper.
      expect(mockUploadMcpSources).toHaveBeenCalledTimes(1);
      expect(mockUploadMcpSources).toHaveBeenCalledWith(client, '/root/.mcp-servers', [
        { kind: 'sourced', name: 'mine', command: 'node', args: ['${MCP_ROOT}/server.js', '--flag'], hostDir: '/tmp/mine' },
        { kind: 'sourceless', name: 'fs', command: 'npx', args: ['-y', 'server-filesystem'] },
      ]);
      // Source-only uploads (uploadDirToSandbox) are not used for MCP payloads.
      expect(mockUploadDir).not.toHaveBeenCalled();

      // The base64-decoded MCP config JSON reflects the resolved args returned by the helper.
      const writeCall = client.runCommand.mock.calls.find((c: any[]) => String(c[0]).includes('base64 -d'));
      expect(writeCall).toBeDefined();
      const b64 = String(writeCall![0]).match(/printf %s '([A-Za-z0-9+/=]+)'/)![1];
      const cfg = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
      expect(cfg.mcpServers.mine).toEqual({ command: 'node', args: ['/root/.mcp-servers/mine/server.js', '--flag'] });
      expect(cfg.mcpServers.fs).toEqual({ command: 'npx', args: ['-y', 'server-filesystem'] });

      // sandboxCommand emits --mcp-config, not --strict-mcp-config.
      const cmd = adapter.sandboxCommand('do the thing');
      expect(cmd).toContain("--mcp-config '/root/.mcp-servers/mcp-config.json'");
      expect(cmd).not.toContain('--strict-mcp-config');
    });

    it('sandboxCommand omits --mcp-config when no MCP servers were installed', () => {
      const fresh = new ClaudeAdapter({ command: 'claude' });
      expect(fresh.sandboxCommand('go')).not.toContain('--mcp-config');
    });
  });
});
