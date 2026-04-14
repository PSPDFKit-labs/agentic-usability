import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SandboxClient } from '../opensandbox.js';

const mockSandbox = {
  files: {
    writeFiles: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockResolvedValue(''),
  },
  commands: {
    run: vi.fn().mockResolvedValue({
      logs: { stdout: [], stderr: [] },
      exitCode: 0,
    }),
  },
  kill: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
};

const mockGetBaseUrl = vi.fn().mockReturnValue('http://localhost:8080');
const mockCloseTransport = vi.fn().mockResolvedValue(undefined);

vi.mock('@alibaba-group/opensandbox', () => ({
  Sandbox: {
    create: vi.fn(async () => mockSandbox),
  },
  ConnectionConfig: class MockConnectionConfig {
    getBaseUrl = mockGetBaseUrl;
    closeTransport = mockCloseTransport;
    constructor(_opts: any) {}
  },
}));

describe('SandboxClient', () => {
  let client: SandboxClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSandbox.files.writeFiles.mockResolvedValue(undefined);
    mockSandbox.files.search.mockResolvedValue([]);
    mockSandbox.files.readFile.mockResolvedValue('');
    mockSandbox.commands.run.mockResolvedValue({
      logs: { stdout: [], stderr: [] },
      exitCode: 0,
    });
    mockSandbox.kill.mockResolvedValue(undefined);
    mockSandbox.close.mockResolvedValue(undefined);
    client = new SandboxClient({ domain: 'localhost:8080' });
  });

  describe('create', () => {
    it('calls Sandbox.create with correct options', async () => {
      const { Sandbox } = await import('@alibaba-group/opensandbox');

      await client.create('node:20', { NODE_ENV: 'test' }, 300);

      expect(Sandbox.create).toHaveBeenCalledWith(
        expect.objectContaining({
          image: 'node:20',
          env: { NODE_ENV: 'test' },
          timeoutSeconds: 300,
          readyTimeoutSeconds: 60,
        }),
      );
    });

    it('uses default timeout of 600 when not specified', async () => {
      const { Sandbox } = await import('@alibaba-group/opensandbox');

      await client.create('node:20');

      expect(Sandbox.create).toHaveBeenCalledWith(
        expect.objectContaining({
          timeoutSeconds: 600,
        }),
      );
    });

    it('throws a descriptive error on failure', async () => {
      const { Sandbox } = await import('@alibaba-group/opensandbox');
      vi.mocked(Sandbox.create).mockRejectedValueOnce(new Error('connection refused'));

      await expect(client.create('bad-image')).rejects.toThrow(
        "Failed to create sandbox with image 'bad-image': connection refused",
      );
    });
  });

  describe('uploadFiles', () => {
    it('calls writeFiles with the provided files', async () => {
      await client.create('node:20');
      const files = [{ path: '/app/index.ts', data: 'console.log("hi")' }];

      await client.uploadFiles(files);

      expect(mockSandbox.files.writeFiles).toHaveBeenCalledWith(files);
    });

    it('throws when no sandbox is active', async () => {
      await expect(
        client.uploadFiles([{ path: '/app/x.ts', data: '' }]),
      ).rejects.toThrow('No sandbox is active');
    });
  });

  describe('runCommand', () => {
    it('runs command and extracts stdout/stderr/exitCode', async () => {
      await client.create('node:20');
      mockSandbox.commands.run.mockResolvedValueOnce({
        logs: {
          stdout: [{ text: 'hello ' }, { text: 'world' }],
          stderr: [{ text: 'warn' }],
        },
        exitCode: 0,
      });

      const result = await client.runCommand('echo hello');

      expect(mockSandbox.commands.run).toHaveBeenCalledWith('echo hello', undefined);
      expect(result).toEqual({
        stdout: 'hello world',
        stderr: 'warn',
        exitCode: 0,
      });
    });

    it('defaults exitCode to 1 when undefined', async () => {
      await client.create('node:20');
      mockSandbox.commands.run.mockResolvedValueOnce({
        logs: { stdout: [], stderr: [] },
        exitCode: undefined,
      });

      const result = await client.runCommand('fail');

      expect(result.exitCode).toBe(1);
    });

    it('throws when no sandbox is active', async () => {
      await expect(client.runCommand('ls')).rejects.toThrow(
        'No sandbox is active',
      );
    });
  });

  describe('runCommandTimed', () => {
    it('adds durationMs to the result', async () => {
      await client.create('node:20');
      mockSandbox.commands.run.mockResolvedValueOnce({
        logs: { stdout: [{ text: 'ok' }], stderr: [] },
        exitCode: 0,
      });

      const result = await client.runCommandTimed('echo ok');

      expect(result.stdout).toBe('ok');
      expect(result.exitCode).toBe(0);
      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('listFiles', () => {
    it('returns file paths from search results', async () => {
      await client.create('node:20');
      mockSandbox.files.search.mockResolvedValueOnce([
        { path: '/app/a.ts' },
        { path: '/app/b.ts' },
      ]);

      const paths = await client.listFiles('/app');

      expect(mockSandbox.files.search).toHaveBeenCalledWith({ path: '/app' });
      expect(paths).toEqual(['/app/a.ts', '/app/b.ts']);
    });
  });

  describe('readFile', () => {
    it('returns file content', async () => {
      await client.create('node:20');
      mockSandbox.files.readFile.mockResolvedValueOnce('file content here');

      const content = await client.readFile('/app/index.ts');

      expect(mockSandbox.files.readFile).toHaveBeenCalledWith('/app/index.ts');
      expect(content).toBe('file content here');
    });
  });

  describe('destroy', () => {
    it('calls kill and close on the sandbox', async () => {
      await client.create('node:20');

      await client.destroy();

      expect(mockSandbox.kill).toHaveBeenCalled();
      expect(mockSandbox.close).toHaveBeenCalled();
    });

    it('does not throw when sandbox is null', async () => {
      await expect(client.destroy()).resolves.toBeUndefined();
    });

    it('does not throw when kill fails', async () => {
      await client.create('node:20');
      mockSandbox.kill.mockRejectedValueOnce(new Error('already dead'));

      await expect(client.destroy()).resolves.toBeUndefined();
      expect(mockSandbox.close).toHaveBeenCalled();
    });

    it('does not throw when close fails', async () => {
      await client.create('node:20');
      mockSandbox.close.mockRejectedValueOnce(new Error('close error'));

      await expect(client.destroy()).resolves.toBeUndefined();
    });
  });

  describe('checkConnectivity', () => {
    const config = { domain: 'localhost:8080' };

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('succeeds on HTTP 200', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', mockFetch);

      await expect(SandboxClient.checkConnectivity(config)).resolves.toBeUndefined();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/health',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('succeeds on HTTP 401', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
      vi.stubGlobal('fetch', mockFetch);

      await expect(SandboxClient.checkConnectivity(config)).resolves.toBeUndefined();
    });

    it('throws descriptive error when server is unreachable', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      vi.stubGlobal('fetch', mockFetch);

      await expect(SandboxClient.checkConnectivity(config)).rejects.toThrow(/OpenSandbox server unreachable/);
    });

    it('throws descriptive error on non-200/401 status', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
      vi.stubGlobal('fetch', mockFetch);

      await expect(SandboxClient.checkConnectivity(config)).rejects.toThrow(/OpenSandbox server unreachable/);
    });
  });
});
