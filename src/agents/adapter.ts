import { AgentConfig, AgentResult } from '../types.js';
import { ClaudeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';
import { GeminiAdapter } from './gemini.js';
import { CustomAdapter } from './custom.js';

export interface AgentAdapter {
  readonly name: string;
  readonly installCommand: string | null;

  /** Full lifecycle: spawn with schema args → envelope unwrap → retry on parse failure → return clean result. */
  run(prompt: string, schema: object, workDir: string, options?: {
    env?: Record<string, string>;
    retries?: number;
  }): Promise<AgentResult>;

  /** Launch interactive agent session with inherited stdio. Resolves when agent exits. */
  interactive(prompt: string, workDir: string): Promise<{ exitCode: number; durationMs: number }>;

  /** Build a complete shell command string for sandbox execution. */
  sandboxCommand(prompt: string, workDir?: string, schema?: object): string;

  /** Unwrap agent-specific envelope from raw stdout, returning the inner content string. */
  extractResult(stdout: string): string;
}

const KNOWN_ADAPTERS: Record<string, new (config: AgentConfig) => AgentAdapter> = {
  claude: ClaudeAdapter,
  codex: CodexAdapter,
  gemini: GeminiAdapter,
};

export function createAdapter(agentConfig: AgentConfig): AgentAdapter {
  const command = agentConfig.command;
  const AdapterClass = KNOWN_ADAPTERS[command];
  if (AdapterClass) {
    return new AdapterClass(agentConfig);
  }
  return new CustomAdapter(agentConfig);
}
