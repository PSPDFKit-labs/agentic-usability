import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MicrosandboxClient, buildSecrets, resolveEnv } from '../microsandbox.js';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockOutput = {
  stdout: vi.fn().mockReturnValue(''),
  stderr: vi.fn().mockReturnValue(''),
  code: 0,
};

const mockFs = {
  write: vi.fn().mockResolvedValue(undefined),
  read: vi.fn().mockResolvedValue(Buffer.from('')),
  readString: vi.fn().mockResolvedValue(''),
  list: vi.fn().mockResolvedValue([]),
  exists: vi.fn().mockResolvedValue(true),
};

const mockSandbox = {
  shell: vi.fn().mockResolvedValue(mockOutput),
  execWithConfig: vi.fn().mockResolvedValue(mockOutput),
  fs: vi.fn().mockReturnValue(mockFs),
  kill: vi.fn().mockResolvedValue(undefined),
  removePersisted: vi.fn().mockResolvedValue(undefined),
};

vi.mock('microsandbox', () => ({
  Sandbox: {
    create: vi.fn(async () => mockSandbox),
  },
  Secret: {
    env: vi.fn((name: string, opts: any) => ({ name, ...opts })),
  },
}));

// ── Helper function tests ────────────────────────────────────────────────────

describe('buildSecrets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when secrets is undefined', () => {
    expect(buildSecrets(undefined)).toEqual([]);
  });

  it('builds Secret.env entries for each secret', async () => {
    const { Secret } = await import('microsandbox');

    const secrets = {
      API_KEY: { value: 'literal-key', allowHosts: ['api.example.com'], allowHostPatterns: [] },
    };

    const result = buildSecrets(secrets);

    expect(Secret.env).toHaveBeenCalledWith('API_KEY', {
      value: 'literal-key',
      allowHosts: ['api.example.com'],
      allowHostPatterns: [],
    });
    expect(result).toHaveLength(1);
  });

  it('resolves $VAR references from process.env', async () => {
    const { Secret } = await import('microsandbox');
    process.env.MY_SECRET = 'resolved-value';

    buildSecrets({
      TOKEN: { value: '$MY_SECRET', allowHosts: ['*'], allowHostPatterns: [] },
    });

    expect(Secret.env).toHaveBeenCalledWith('TOKEN', expect.objectContaining({ value: 'resolved-value' }));
    delete process.env.MY_SECRET;
  });

  it('throws when referenced host env var is missing', () => {
    delete process.env.NONEXISTENT_VAR;

    expect(() =>
      buildSecrets({
        TOKEN: { value: '$NONEXISTENT_VAR', allowHosts: [], allowHostPatterns: [] },
      }),
    ).toThrow("Environment variable 'NONEXISTENT_VAR' referenced in sandbox config for TOKEN is not set on the host");
  });
});

describe('resolveEnv', () => {
  it('returns empty object when env is undefined', () => {
    expect(resolveEnv(undefined)).toEqual({});
  });

  it('passes through literal values', () => {
    expect(resolveEnv({ NODE_ENV: 'test', FOO: 'bar' })).toEqual({
      NODE_ENV: 'test',
      FOO: 'bar',
    });
  });

  it('resolves $VAR references from process.env', () => {
    process.env.HOST_VAR = 'host-value';
    expect(resolveEnv({ MY_VAR: '$HOST_VAR' })).toEqual({ MY_VAR: 'host-value' });
    delete process.env.HOST_VAR;
  });

  it('throws when referenced host env var is missing', () => {
    delete process.env.MISSING;
    expect(() => resolveEnv({ X: '$MISSING' })).toThrow(
      "Environment variable 'MISSING' referenced in sandbox config for X is not set on the host",
    );
  });
});

// ── MicrosandboxClient tests ─────────────────────────────────────────────────

describe('MicrosandboxClient', () => {
  let client: MicrosandboxClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOutput.stdout.mockReturnValue('');
    mockOutput.stderr.mockReturnValue('');
    mockOutput.code = 0;
    mockFs.write.mockResolvedValue(undefined);
    mockFs.read.mockResolvedValue(Buffer.from(''));
    mockFs.readString.mockResolvedValue('');
    mockFs.list.mockResolvedValue([]);
    mockFs.exists.mockResolvedValue(true);
    mockSandbox.shell.mockResolvedValue(mockOutput);
    mockSandbox.execWithConfig.mockResolvedValue(mockOutput);
    mockSandbox.kill.mockResolvedValue(undefined);
    mockSandbox.removePersisted.mockResolvedValue(undefined);
    client = new MicrosandboxClient({});
  });

  describe('create', () => {
    it('calls Sandbox.create with correct config', async () => {
      const { Sandbox } = await import('microsandbox');

      await client.create('test-sb', 'node:20', { NODE_ENV: 'test' }, [], 300);

      expect(Sandbox.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test-sb',
          image: 'node:20',
          env: { NODE_ENV: 'test' },
          maxDurationSecs: 300 + 120,
          replace: true,
        }),
      );
    });

    it('uses default timeout of 600 when not specified', async () => {
      const { Sandbox } = await import('microsandbox');

      await client.create('sb', 'node:20');

      expect(Sandbox.create).toHaveBeenCalledWith(
        expect.objectContaining({ maxDurationSecs: 600 + 120 }),
      );
    });

    it('respects config.defaultTimeout', async () => {
      const { Sandbox } = await import('microsandbox');
      const c = new MicrosandboxClient({ defaultTimeout: 120 });

      await c.create('sb', 'node:20');

      expect(Sandbox.create).toHaveBeenCalledWith(
        expect.objectContaining({ maxDurationSecs: 120 + 120 }),
      );
    });

    it('throws a descriptive error on failure', async () => {
      const { Sandbox } = await import('microsandbox');
      vi.mocked(Sandbox.create).mockRejectedValueOnce(new Error('connection refused'));

      await expect(client.create('sb', 'bad-image')).rejects.toThrow(
        "Failed to create sandbox 'sb' with image 'bad-image': connection refused",
      );
    });
  });

  describe('uploadFiles', () => {
    it('writes each file via fs.write', async () => {
      await client.create('sb', 'node:20');

      await client.uploadFiles([
        { path: '/app/index.ts', data: 'console.log("hi")' },
        { path: '/app/util.ts', data: 'export const x = 1' },
      ]);

      expect(mockFs.write).toHaveBeenCalledTimes(2);
      expect(mockFs.write).toHaveBeenCalledWith('/app/index.ts', expect.any(Buffer));
      expect(mockFs.write).toHaveBeenCalledWith('/app/util.ts', expect.any(Buffer));
    });

    it('throws when no sandbox is active', async () => {
      await expect(
        client.uploadFiles([{ path: '/app/x.ts', data: '' }]),
      ).rejects.toThrow('No sandbox is active');
    });
  });

  describe('runCommand', () => {
    it('runs command via shell and returns stdout/stderr/exitCode', async () => {
      await client.create('sb', 'node:20');
      mockOutput.stdout.mockReturnValue('hello world');
      mockOutput.stderr.mockReturnValue('warn');
      mockOutput.code = 0;

      const result = await client.runCommand('echo hello');

      expect(mockSandbox.shell).toHaveBeenCalledWith('echo hello');
      expect(result).toEqual({ stdout: 'hello world', stderr: 'warn', exitCode: 0 });
    });

    it('uses execWithConfig when timeoutMs is provided', async () => {
      await client.create('sb', 'node:20');

      await client.runCommand('slow-cmd', { timeoutMs: 5000 });

      expect(mockSandbox.execWithConfig).toHaveBeenCalledWith({
        cmd: '/bin/sh',
        args: ['-c', 'slow-cmd'],
        timeoutMs: 5000,
      });
      expect(mockSandbox.shell).not.toHaveBeenCalled();
    });

    it('throws when no sandbox is active', async () => {
      await expect(client.runCommand('ls')).rejects.toThrow('No sandbox is active');
    });
  });

  describe('runCommandTimed', () => {
    it('adds durationMs to the result', async () => {
      await client.create('sb', 'node:20');
      mockOutput.stdout.mockReturnValue('ok');

      const result = await client.runCommandTimed('echo ok');

      expect(result.stdout).toBe('ok');
      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('listFiles', () => {
    it('returns paths directly from fs.list entries (agentd returns absolute paths)', async () => {
      await client.create('sb', 'node:20');
      mockFs.list.mockResolvedValueOnce([{ path: '/app/a.ts' }, { path: '/app/b.ts' }]);

      const paths = await client.listFiles('/app');

      expect(mockFs.list).toHaveBeenCalledWith('/app');
      expect(paths).toEqual(['/app/a.ts', '/app/b.ts']);
    });
  });

  describe('readFile', () => {
    it('returns file content as string', async () => {
      await client.create('sb', 'node:20');
      mockFs.readString.mockResolvedValueOnce('file content');

      const content = await client.readFile('/app/index.ts');

      expect(mockFs.readString).toHaveBeenCalledWith('/app/index.ts');
      expect(content).toBe('file content');
    });
  });

  describe('readBinaryFile', () => {
    it('returns file content as Buffer', async () => {
      await client.create('sb', 'node:20');
      const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      mockFs.read.mockResolvedValueOnce(buf);

      const result = await client.readBinaryFile('/app/image.png');

      expect(mockFs.read).toHaveBeenCalledWith('/app/image.png');
      expect(result).toBe(buf);
    });
  });

  describe('fileExists', () => {
    it('returns true when file exists', async () => {
      await client.create('sb', 'node:20');
      mockFs.exists.mockResolvedValueOnce(true);

      expect(await client.fileExists('/app/index.ts')).toBe(true);
    });

    it('returns false when fs.exists throws', async () => {
      await client.create('sb', 'node:20');
      mockFs.exists.mockRejectedValueOnce(new Error('fail'));

      expect(await client.fileExists('/app/nope')).toBe(false);
    });
  });

  describe('destroy', () => {
    it('calls kill and removePersisted on the sandbox', async () => {
      await client.create('sb', 'node:20');

      await client.destroy();

      expect(mockSandbox.kill).toHaveBeenCalled();
      expect(mockSandbox.removePersisted).toHaveBeenCalled();
    });

    it('does not throw when sandbox is null', async () => {
      await expect(client.destroy()).resolves.toBeUndefined();
    });

    it('does not throw when kill fails', async () => {
      await client.create('sb', 'node:20');
      mockSandbox.kill.mockRejectedValueOnce(new Error('already dead'));

      await expect(client.destroy()).resolves.toBeUndefined();
      expect(mockSandbox.removePersisted).toHaveBeenCalled();
    });

    it('does not throw when removePersisted fails', async () => {
      await client.create('sb', 'node:20');
      mockSandbox.removePersisted.mockRejectedValueOnce(new Error('cleanup error'));

      await expect(client.destroy()).resolves.toBeUndefined();
    });
  });
});