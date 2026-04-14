import { vi } from 'vitest';

export function makeMockSandboxClient() {
  return {
    create: vi.fn(),
    uploadFiles: vi.fn(),
    runCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    runCommandTimed: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 100 }),
    listFiles: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockResolvedValue(''),
    destroy: vi.fn(),
  };
}
