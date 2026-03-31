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
  functionalEquivalence: number;
  apiCorrectness: number;
  idiomaticUsage: number;
  overallSimilarity: number;
  functionalMatch: boolean;
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
}

export interface PublicInfo {
  docsUrl?: string;
  guides?: string[];
  packageName?: string;
  installCommand?: string;
  additionalContext?: string;
}

export interface AgentConfig {
  command: string;
  args?: string[];
}

export interface TargetConfig {
  name: string;
  image: string;
  timeout?: number;
}

export interface WorkspaceConfig {
  template?: string;
  setupScript?: string;
  env?: Record<string, string>;
}

export interface SandboxConfig {
  domain: string;
  apiKey?: string;
  concurrency?: number;
  defaultTimeout?: number;
  systemPrompt?: string;
}

export interface OutputConfig {
  dir?: string;
  suiteFile?: string;
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
  output?: OutputConfig;
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
