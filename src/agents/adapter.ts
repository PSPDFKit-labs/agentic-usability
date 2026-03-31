import { AgentConfig, AgentResult } from '../core/types.js';
import { ClaudeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';
import { GeminiAdapter } from './gemini.js';
import { CustomAdapter } from './custom.js';

export interface AgentAdapter {
  name: string;
  execute(prompt: string, workDir: string, env?: Record<string, string>): Promise<AgentResult>;
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
