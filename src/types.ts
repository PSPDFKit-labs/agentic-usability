export interface SolutionFile {
  path: string;
  content: string;
}

export interface TestCase {
  id: string;
  problemStatement: string;
  referenceSolution: SolutionFile[];
  difficulty: 'easy' | 'medium' | 'hard';
  tags: string[];
  setupInstructions?: string;
}

export interface AgentResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
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

export interface LocalSource {
  type: 'local';
  path: string;
  subpath?: string;
  additionalContext?: string;
}

export interface GitSource {
  type: 'git';
  url: string;
  branch?: string;
  subpath?: string;
  sparse?: string[];
  additionalContext?: string;
}

export interface UrlSource {
  type: 'url';
  url: string;
  additionalContext?: string;
}

export interface PackageSource {
  type: 'package';
  name: string;
  installCommand?: string;
  /** Preferred solution language (e.g. "python"). When set, both generator and executor will use this. */
  language?: string;
  additionalContext?: string;
}

export type SourceConfig = LocalSource | GitSource | UrlSource | PackageSource;

/** Get the first PackageSource from a source array. */
export function getPackageSource(sources: SourceConfig[]): PackageSource | undefined {
  return sources.find((s): s is PackageSource => s.type === 'package');
}

/** Get all UrlSource entries from a source array. */
export function getUrlSources(sources: SourceConfig[]): UrlSource[] {
  return sources.filter((s): s is UrlSource => s.type === 'url');
}

/** Get all file-resolvable sources (local + git) from a source array. */
export function getFileSources(sources: SourceConfig[]): (LocalSource | GitSource)[] {
  return sources.filter((s): s is LocalSource | GitSource => s.type === 'local' || s.type === 'git');
}

export interface AgentSecretConfig {
  /** Env var name for the API key. Auto-detected for known agents (claude/codex/gemini). Required for custom agents. */
  envVar?: string;
  /** Raw value or "$ENV_VAR" reference resolved from host environment. */
  value: string;
  /** API base URL (e.g. "https://api.anthropic.com"). Auto-detected for known agents. Required for custom agents. */
  baseUrl?: string;
  /** Env var name for the base URL override. Auto-detected for known agents (claude/codex/gemini). */
  baseUrlEnvVar?: string;
}

export interface AgentConfig {
  command: string;
  /** Base args used in all modes. Supports {prompt} and {workDir} placeholders for custom agents. */
  args?: string[];
  /** Args used only in interactive mode (overrides args when present). Custom agents only. */
  interactiveArgs?: string[];
  /** Args used only in piped/non-interactive mode (overrides args when present). Custom agents only. */
  pipedArgs?: string[];
  /** Args used only in sandbox mode (overrides args when present). Custom agents only. */
  sandboxArgs?: string[];
  /** Override the npm/pip install command for this agent (used inside sandbox). */
  installCommand?: string;
  /** JSON field path to extract structured output from stdout envelope (e.g. "response", "result"). "none" means raw stdout is the output. */
  envelope?: string;
  /** System prompt template for this agent. Supports {{packageName}} and {{docsUrl}} placeholders. */
  systemPrompt?: string;
  /** Glob pattern for finding agent session logs inside sandbox (used by custom adapters). */
  logPattern?: string;
}

/** Agent config for sandboxed execution (executor/judge). Secret is required for microsandbox TLS injection. */
export interface SandboxAgentConfig extends AgentConfig {
  /** Agent's API secret and base URL. Flows to microsandbox TLS injection, sandbox env, and judge lockdown allowlist. */
  secret: AgentSecretConfig;
}

export interface TargetConfig {
  name: string;
  image: string;
  timeout?: number;
  /** Extra context about the target environment, included in the generator prompt
   *  so it can produce correct setupInstructions (e.g. "Use uv instead of pip"). */
  additionalContext?: string;
}

export interface WorkspaceConfig {
  template?: string;
  setupScript?: string;
}

export interface SecretConfig {
  /** Raw value or "$ENV_VAR" reference resolved from host environment. */
  value: string;
  /** Domains where this secret is allowed to be sent (e.g. ["api.anthropic.com"]). */
  allowHosts: string[];
  /** Glob patterns for allowed hosts (e.g. ["*.googleapis.com"]). */
  allowHostPatterns?: string[];
}

export interface SandboxConfig {
  concurrency?: number;
  defaultTimeout?: number;
  memoryMib?: number;
  cpus?: number;
  /** Secrets handled by microsandbox — real values never enter the VM.
   *  Keys are env var names, values configure host restrictions. */
  secrets?: Record<string, SecretConfig>;
  /** Plain env vars passed directly into the sandbox (e.g. license keys validated in-guest). */
  env?: Record<string, string>;
}

export interface Config {
  privateInfo: SourceConfig[];
  publicInfo?: SourceConfig[];
  agents?: {
    generator?: AgentConfig;
    executor?: SandboxAgentConfig;
    judge?: SandboxAgentConfig;
    insights?: AgentConfig;
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
    execute: Record<string, string[]>;
    judge: Record<string, string[]>;
  };
}

export interface TestResult {
  testId: string;
  difficulty: 'easy' | 'medium' | 'hard';
  problemStatement: string;
  judgeScore: JudgeScore | null;
  generatedSolution: SolutionFile[] | null;
  agentNotes: string | null;
}

export interface AggregateResults {
  target: string;
  testResults: TestResult[];
  avgApiDiscovery: number;
  avgCallCorrectness: number;
  avgCompleteness: number;
  avgFunctionalCorrectness: number;
  passRate: number;
  byDifficulty: Record<string, { avgApiDiscovery: number; avgCallCorrectness: number; avgCompleteness: number; avgFunctionalCorrectness: number; passRate: number; count: number }>;
}

export interface RunInfo {
  id: string;
  createdAt: string;
  targets: string[];
  testCount: number;
  label: string | null;
}

export interface ProjectPaths {
  /** Absolute path to the project root directory. */
  root: string;
  /** Absolute path to the config file. */
  config: string;
  /** Absolute path to the suite JSON file. */
  suite: string;
  /** Absolute path to the results directory. */
  results: string;
  /** Absolute path to the cache root directory. */
  cache: string;
  /** Absolute path to the git repos cache directory. */
  cacheRepos: string;
  /** Absolute path to the pipeline state file. */
  pipelineState: string;
}
