import { vi } from 'vitest';

export function makeMockSandboxClient() {
  return {
    create: vi.fn(),
    getSandbox: vi.fn().mockReturnValue({}),
    uploadFiles: vi.fn(),
    runCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    runCommandTimed: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 100 }),
    listFiles: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockResolvedValue(''),
    readBinaryFile: vi.fn().mockResolvedValue(Buffer.alloc(0)),
    uploadBinaryFile: vi.fn(),
    fileExists: vi.fn().mockResolvedValue(false),
    destroy: vi.fn(),
  };
}
