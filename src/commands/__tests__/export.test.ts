import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeConfig } from '../../__tests__/helpers/fixtures.js';

vi.mock('../../core/config.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  copyFile: vi.fn(),
  stat: vi.fn(),
}));

import { loadConfig } from '../../core/config.js';
import { copyFile, stat } from 'node:fs/promises';
import { exportCommand } from '../export.js';

describe('exportCommand', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    vi.mocked(loadConfig).mockResolvedValue(makeConfig());
    vi.mocked(stat).mockResolvedValue({} as any);
    vi.mocked(copyFile).mockResolvedValue(undefined);
  });

  it('copies suite file to the specified output path', async () => {
    await exportCommand({ output: '/tmp/out.json' });

    expect(stat).toHaveBeenCalledWith(expect.stringContaining('suite.json'));
    expect(copyFile).toHaveBeenCalledWith(
      expect.stringContaining('suite.json'),
      expect.stringContaining('out.json'),
    );
  });

  it('throws when suite file does not exist', async () => {
    vi.mocked(stat).mockRejectedValue(new Error('ENOENT'));

    await expect(exportCommand({ output: '/tmp/out.json' })).rejects.toThrow(
      /Suite file not found/,
    );
  });
});
