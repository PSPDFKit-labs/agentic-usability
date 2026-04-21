import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFile, readdir, stat } from 'node:fs/promises';
import { scaffoldWorkspace } from '../scaffolding.js';
import { makeTestCase, makeConfig } from '../../__tests__/helpers/fixtures.js';
import { makeMockSandboxClient } from '../../__tests__/helpers/mock-sandbox-client.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
}));

const mockReadFile = vi.mocked(readFile);
const mockReaddir = vi.mocked(readdir);
const mockStat = vi.mocked(stat);

describe('scaffoldWorkspace', () => {
  let client: ReturnType<typeof makeMockSandboxClient>;

  beforeEach(() => {
    client = makeMockSandboxClient();
  });

  it('returns empty log when no template, setupScript, or setupInstructions', async () => {
    const config = makeConfig();
    const tc = makeTestCase();
    const log = await scaffoldWorkspace(client as any, config, tc);
    expect(log).toBe('');
  });

  it('installs curl in sandbox', async () => {
    const config = makeConfig();
    await scaffoldWorkspace(client as any, config, makeTestCase());

    expect(client.runCommand).toHaveBeenCalledWith(
      expect.stringContaining('command -v curl'),
    );
  });

  it('uploads template directory files to /workspace/ (Layer 2)', async () => {
    const config = makeConfig({ workspace: { template: '/templates/basic' } });
    mockStat.mockResolvedValue({} as any);
    mockReaddir.mockResolvedValue([
      { name: 'index.ts', isDirectory: () => false, isFile: () => true } as any,
    ]);
    mockReadFile.mockResolvedValue('file content');

    const log = await scaffoldWorkspace(client as any, config, makeTestCase());
    expect(client.uploadFiles).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ path: expect.stringContaining('/workspace/'), data: 'file content' }),
      ]),
    );
    expect(log).toContain('[Layer 2]');
  });

  it('throws when template directory does not exist', async () => {
    const config = makeConfig({ workspace: { template: '/nonexistent' } });
    mockStat.mockRejectedValue(new Error('ENOENT'));

    await expect(scaffoldWorkspace(client as any, config, makeTestCase()))
      .rejects.toThrow(/Template directory not found/);
  });

  it('handles empty template directory', async () => {
    const config = makeConfig({ workspace: { template: '/templates/empty' } });
    mockStat.mockResolvedValue({} as any);
    mockReaddir.mockResolvedValue([]);

    const log = await scaffoldWorkspace(client as any, config, makeTestCase());
    expect(log).toContain('empty');
    expect(client.uploadFiles).not.toHaveBeenCalled();
  });

  it('uploads and executes global setup script (Layer 3)', async () => {
    const config = makeConfig({ workspace: { setupScript: '/scripts/setup.sh' } });
    mockReadFile.mockResolvedValue('#!/bin/bash\necho hello');

    const log = await scaffoldWorkspace(client as any, config, makeTestCase());
    expect(client.uploadFiles).toHaveBeenCalledWith([
      expect.objectContaining({ path: '/workspace/.setup.sh' }),
    ]);
    expect(client.runCommand).toHaveBeenLastCalledWith(
      'chmod +x /workspace/.setup.sh && /workspace/.setup.sh',
    );
    expect(log).toContain('[Layer 3]');
  });

  it('throws when global setup script fails with non-zero exit', async () => {
    const config = makeConfig({ workspace: { setupScript: '/scripts/setup.sh' } });
    mockReadFile.mockResolvedValue('#!/bin/bash');
    client.runCommand.mockResolvedValue({ stdout: '', stderr: 'error', exitCode: 1 });

    await expect(scaffoldWorkspace(client as any, config, makeTestCase()))
      .rejects.toThrow(/Global setup script failed/);
  });

  it('executes per-test setupInstructions (Layer 4)', async () => {
    const config = makeConfig();
    const tc = makeTestCase({ setupInstructions: 'npm install' });

    const log = await scaffoldWorkspace(client as any, config, tc);
    expect(client.runCommand).toHaveBeenLastCalledWith('npm install');
    expect(log).toContain('[Layer 4]');
  });

  it('logs warning but does not throw when per-test setup fails', async () => {
    const config = makeConfig();
    const tc = makeTestCase({ setupInstructions: 'npm install' });
    client.runCommand.mockResolvedValue({ stdout: '', stderr: 'warn', exitCode: 1 });

    const log = await scaffoldWorkspace(client as any, config, tc);
    expect(log).toContain('Warning');
  });
});
