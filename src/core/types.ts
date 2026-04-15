export interface SolutionFile {
  path: string;
  content: string;
}

export interface TestCase {
  id: string;
  problemStatement: string;
  referenceSolution: SolutionFile[];
  difficulty: 'easy' | 'medium' | 'hard';
  targetApis: string[];
  expectedTokens: string[];
  tags: string[];
  setupInstructions?: string;
}

export interface AgentResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface TokenResult {
  token: string;
  found: boolean;
  foundIn?: string;
}

export interface TokenAnalysis {
  testId: string;
  target: string;
  apis: TokenResult[];
  tokens: TokenResult[];
  apiCoverage: number;
  tokenCoverage: number;
}

export interface JudgeScore {
  testId: string;
  target: string;
  apiDiscovery: number;
  callCorrectness: number;
  completeness: number;
  functionalCorrectness: number;
  overallVerdict: boolean;
  notes: string;
}

export interface SourceConfig {
  type: 'local' | 'git' | 'url';
  path?: string;
  url?: string;
  urls?: string[];
  branch?: string;
  subpath?: string;
  sparse?: string[];
  /** Extra context appended to the generator prompt (e.g. SDK conventions, focus areas). */
  additionalContext?: string;
}

export interface PublicInfo {
  docsUrl?: string;
  guides?: string[];
  packageName?: string;
  installCommand?: string;
  additionalContext?: string;
  /** Preferred solution language (e.g. "python"). When set, both generator and executor will use this. */
  language?: string;
}

export interface AgentConfig {
  command: string;
  /** Base args used in all modes. Supports {prompt} and {workDir} placeholders for custom agents. */
  args?: string[];
  /** Args used only in interactive mode (overrides args when present). */
  interactiveArgs?: string[];
  /** Args used only in piped/non-interactive mode (overrides args when present). */
  pipedArgs?: string[];
  /** Extra args appended only in sandbox mode (e.g. permission-skipping flags). */
  sandboxArgs?: string[];
  /** Override the npm/pip install command for this agent (used inside sandbox). */
  installCommand?: string;
  /** Timeout in milliseconds for piped execution. Default: 300000 (5 min). */
  timeout?: number;
  /** JSON field path to extract structured output from stdout envelope (e.g. "response", "result"). "none" means raw stdout is the output. */
  envelope?: string;
}

export interface TargetConfig {
  name: string;
  image: string;
  timeout?: number;
}

export interface WorkspaceConfig {
  template?: string;
  setupScript?: string;
}

export interface SandboxConfig {
  domain: string;
  apiKey?: string;
  concurrency?: number;
  defaultTimeout?: number;
  systemPrompt?: string;
  /** Env vars for the sandbox container. Known secrets (ANTHROPIC_API_KEY, etc.)
   *  are routed through the auth proxy; everything else is passed through as-is.
   *  All vars are baked into the container at creation time. */
  env?: Record<string, string>;
}

export interface Config {
  source: SourceConfig;
  publicInfo?: PublicInfo;
  agents?: {
    generator?: AgentConfig;
    executor?: AgentConfig;
    judge?: AgentConfig;
  };
  targets: TargetConfig[];
  workspace?: WorkspaceConfig;
  sandbox: SandboxConfig;
}

export interface PipelineState {
  stage: string;
  startedAt: string;
  testCases: number;
  completed: {
    generate: string[];
    execute: string[];
    analyze: string[];
    judge: string[];
  };
}
