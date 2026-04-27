import { describe, it, expect } from 'vitest';
import { createAdapter } from '../adapter.js';
import { ClaudeAdapter } from '../claude.js';
import { CodexAdapter } from '../codex.js';
import { GeminiAdapter } from '../gemini.js';
import { CustomAdapter } from '../custom.js';

describe('createAdapter', () => {
  it('returns ClaudeAdapter for command "claude"', () => {
    const adapter = createAdapter({ command: 'claude' });
    expect(adapter).toBeInstanceOf(ClaudeAdapter);
    expect(adapter.name).toBe('claude');
  });

  it('returns CodexAdapter for command "codex"', () => {
    const adapter = createAdapter({ command: 'codex' });
    expect(adapter).toBeInstanceOf(CodexAdapter);
    expect(adapter.name).toBe('codex');
  });

  it('returns GeminiAdapter for command "gemini"', () => {
    const adapter = createAdapter({ command: 'gemini' });
    expect(adapter).toBeInstanceOf(GeminiAdapter);
    expect(adapter.name).toBe('gemini');
  });

  it('returns CustomAdapter for unknown commands', () => {
    const adapter = createAdapter({ command: 'my-agent' });
    expect(adapter).toBeInstanceOf(CustomAdapter);
    expect(adapter.name).toBe('custom:my-agent');
  });

  it('returns correct installCommand for each adapter type', () => {
    expect(createAdapter({ command: 'claude' }).installCommand).toBe('npm i -g @anthropic-ai/claude-code');
    expect(createAdapter({ command: 'codex' }).installCommand).toBe('npm i -g @openai/codex');
    expect(createAdapter({ command: 'gemini' }).installCommand).toBe('npm i -g @google/gemini-cli');
    expect(createAdapter({ command: 'my-agent' }).installCommand).toBeNull();
  });
});
