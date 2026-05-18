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

/** Agent config for sandboxed execution (executor/judge).
 *
 * Both auth modes flow through microsandbox `Secret.env()` TLS substitution —
 * the cleartext credential never enters the VM. Inside the sandbox the env
 * var contains a `$MSB_<name>` placeholder; microsandbox swaps it for the
 * real value on outbound TLS to the allowed host only.
 *
 * The resolved `secret.value`'s prefix picks which env var name carries the
 * placeholder:
 *
 * - `sk-ant-oat…` (Claude Code subscription OAuth token, issued by
 *   `claude setup-token`, requires Pro / Max / Team / Enterprise) →
 *   `CLAUDE_CODE_OAUTH_TOKEN`. Avoids per-token API billing.
 * - anything else (API keys for known agents, custom-agent secrets) →
 *   `secret.envVar` (= `ANTHROPIC_API_KEY` for claude, etc.).
 *
 * Point `secret.value` at the host env var that holds the credential —
 * `$ANTHROPIC_API_KEY` for the API-key path, `$CLAUDE_CODE_OAUTH_TOKEN` for
 * the subscription path.
 */
export interface SandboxAgentConfig extends AgentConfig {
  /** Agent's secret and base URL. Auth mode is determined from the resolved value's prefix. */
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

/**
 * Source of a plugin directory tree to install into the executor's agent CLI.
 * Resolved to a local filesystem path by the source resolver; the adapter then
 * lays the tree out wherever its CLI expects to find plugins.
 */
export interface LocalExecutorPlugin {
  type: 'local';
  /** Plugin slug — used as the directory name under the CLI's plugins dir. */
  name: string;
  /** Absolute or relative path to a directory containing the adapter-specific plugin manifest. */
  path: string;
}

export interface GitExecutorPlugin {
  type: 'git';
  name: string;
  url: string;
  branch?: string;
  /** Path within the cloned repo that contains the plugin manifest. */
  subpath?: string;
  sparse?: string[];
}

export type ExecutorPlugin = LocalExecutorPlugin | GitExecutorPlugin;

/**
 * An ExecutorPlugin after host-side resolution. The adapter receives this and
 * decides how to install it inside the sandbox VM.
 */
export interface ResolvedExecutorPlugin {
  name: string;
  /** Absolute path on the host to the plugin directory. */
  hostDir: string;
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
  /**
   * Plugin directories to install into the executor agent's CLI inside the sandbox VM.
   * Each adapter knows where its CLI expects plugins on disk (Claude: `~/.claude/plugins/`,
   * Codex: `~/.codex/plugins/`, Gemini: not yet supported in non-interactive mode).
   * Plugins are scoped to the executor — the judge sandbox is intentionally not seeded
   * with these so judge scoring stays independent of the executor's tooling.
   */
  executorPlugins?: ExecutorPlugin[];
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
