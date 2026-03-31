# PRD: Agentic Usability — SDK Usability Benchmark for AI Agents

## Introduction

A CLI tool that lets SDK authors measure how usable their SDK is from an AI agent's perspective. The tool generates programming problems solvable with the target SDK, runs AI coding agents (Claude Code, Codex, Gemini CLI, etc.) in sandboxed environments to attempt solutions, then evaluates the generated code using two complementary scoring mechanisms:

- **Code Token Analysis (deterministic):** Regex-based search for expected SDK API calls, parameters, and patterns in the generated code
- **LLM Judge (holistic):** An AI compares the reference and generated solutions for functional equivalence, correctness, and idiomatic usage

**Pipeline overview:**

```
[Source Repo/URL] → [Test Generation Agent] → [Test Suite JSON]
                                                     ↓
        [OpenSandbox] ← [Execution Agent (public info only)]
                                                     ↓
                                     [Extract Solution Files JSON]
                                                     ↓
                              ┌──────────────────────┴──────────────────────┐
                              ↓                                             ↓
                   [Code Token Analysis]                          [LLM Judge Comparison]
                   (regex: API coverage)                    (holistic: similarity scoring)
                              └──────────────────────┬──────────────────────┘
                                                     ↓
                                              [Scorecard]
```

Both the internal reference solution and the sandbox-generated solution use a standardized JSON file list schema, enabling consistent comparison.

The system is AI-agnostic: any CLI-based coding agent can be plugged in for both test generation and solution execution.

## Goals

- Enable SDK authors to quantitatively measure how well AI agents can use their SDK
- Identify specific API surfaces, patterns, or documentation gaps that cause AI agents to fail
- Support any CLI-based AI coding agent (Claude Code, Codex, Gemini CLI, etc.) via a pluggable adapter pattern
- Run solutions in isolated sandboxes via OpenSandbox for realistic environment simulation
- Score using token coverage (deterministic) and LLM judge (qualitative) — no build/compile dependency
- Export/import test suites as JSON for reproducibility and sharing

---

# Epic 1: CLI Foundation & Configuration

Sets up the project skeleton, config system, and source repo access — the plumbing everything else builds on.

## Implementation Details

### Source Repo Access

The tool needs to give AI agents access to SDK source code. Three modes are supported:

**Local path:** User points to a directory on disk. The test-generation agent gets read access via its working directory.
```json
{ "source": { "type": "local", "path": "/Users/dev/my-sdk" } }
```
- Validated at init time (directory exists, is a git repo or has a `package.json`/`setup.py`/etc.)
- Agent's `workDir` is set to this path directly — no copying
- For sandbox execution, public docs are injected instead (the sandbox never sees source)

**Git remote:** User provides a clone URL. The tool clones it to a temp directory.
```json
{ "source": { "type": "git", "url": "https://github.com/org/sdk.git", "branch": "main", "sparse": ["src/", "docs/", "examples/"] } }
```
- Cloned via `git clone --depth 1 --branch <branch>` into `.agentic-usability/repos/<hash>/`
- Optional sparse checkout to avoid pulling huge repos (tests, assets, etc.)
- Re-cloned on `generate` if stale (or `--fresh` flag)
- SSH and HTTPS URLs both supported — relies on user's local git credentials

**URL:** User provides one or more URLs (docs sites, GitHub pages, etc.). Content is fetched, converted to markdown, and saved to a temp directory.
```json
{ "source": { "type": "url", "urls": ["https://sdk.example.com/docs", "https://github.com/org/sdk"] } }
```
- Each URL is fetched, HTML converted to markdown
- Saved to `.agentic-usability/repos/url-<hash>/`
- Agent explores these as local files
- Use case: test whether the AI can generate problems from public docs alone, or compare results when source is "full repo" vs "just docs URL"

**Monorepo subpath:** For monorepos, allow `subpath` to scope the agent to a subdirectory (works with `local` and `git`):
```json
{ "source": { "type": "local", "path": "/Users/dev/monorepo", "subpath": "packages/sdk" } }
```

### Config File Structure

`.agentic-usability.json` in the project root:

```json
{
  "source": {
    "type": "local | git | url",
    "path": "/path/to/sdk",
    "url": "https://github.com/org/sdk.git",
    "urls": ["https://sdk.example.com/docs"],
    "branch": "main",
    "subpath": "packages/sdk",
    "sparse": ["src/", "docs/"]
  },
  "publicInfo": {
    "docsUrl": "https://sdk.example.com/docs",
    "guides": ["https://sdk.example.com/getting-started"],
    "packageName": "my-sdk",
    "installCommand": "npm install my-sdk",
    "additionalContext": "Use v3 API, not the deprecated v2 endpoints"
  },
  "agents": {
    "generator": { "command": "claude", "args": ["--print", "--dangerously-skip-permissions"] },
    "executor": { "command": "claude", "args": ["--print", "--dangerously-skip-permissions"] },
    "judge": { "command": "claude", "args": ["--print"] }
  },
  "targets": [
    {
      "name": "node",
      "image": "node:20-slim",
      "timeout": 600
    },
    {
      "name": "python",
      "image": "python:3.12-slim",
      "timeout": 600
    }
  ],
  "workspace": {
    "template": "./templates/node-basic",
    "setupScript": "./setup.sh",
    "env": {
      "SDK_VERSION": "3.2.0"
    }
  },
  "sandbox": {
    "domain": "localhost:8080",
    "apiKey": "",
    "concurrency": 3,
    "defaultTimeout": 600,
    "systemPrompt": "You are solving a programming problem. Use the {{packageName}} package. Refer to {{docsUrl}} for documentation."
  },
  "output": {
    "dir": ".agentic-usability/results",
    "suiteFile": ".agentic-usability/suite.json"
  }
}
```

### Project Structure

```
src/
  index.ts              # CLI entry point
  commands/             # One file per CLI command
    init.ts
    generate.ts
    execute.ts
    analyze.ts
    judge.ts
    report.ts
    run.ts
  core/
    config.ts           # Config loading, validation, schema
    pipeline.ts         # Pipeline state machine & persistence
    types.ts            # Shared TypeScript types (Solution, TestCase, etc.)
  agents/
    adapter.ts          # AgentAdapter interface
    claude.ts           # Claude Code adapter
    codex.ts            # Codex CLI adapter
    gemini.ts           # Gemini CLI adapter
    custom.ts           # Shell command template adapter
  sandbox/
    opensandbox.ts      # OpenSandbox client wrapper
    executor.ts         # Orchestrates sandbox creation + agent execution
    extractor.ts        # Extracts solution files from sandbox → SolutionFile[]
  scoring/
    tokens.ts           # Regex-based code token analysis
    judge.ts            # LLM judge comparison
  reporting/
    scorecard.ts        # Terminal table output
    export.ts           # JSON export
```

## User Stories

### US-001: CLI scaffolding
**Description:** As a developer, I want the base CLI application set up with command routing and help text.

**Acceptance Criteria:**
- [ ] TypeScript project with `tsconfig.json`, `package.json`, ESM module format, Node.js >= 20
- [ ] CLI entry point using `commander` with subcommands: `init`, `generate`, `execute`, `analyze`, `judge`, `report`, `run`, `export`, `import`
- [ ] `--help` shows usage for each command; `--version` shows version
- [ ] Project lints cleanly with ESLint and typechecks with `tsc --noEmit`

### US-002: Project initialization and configuration
**Description:** As an SDK author, I want to run `agentic-usability init` to create a config file interactively.

**Acceptance Criteria:**
- [ ] Interactive prompts ask for: source type (local/git/url), path or URL(s), public docs URL, package name, install command, agent commands, target environments, OpenSandbox connection details
- [ ] Writes `.agentic-usability.json` with validated content
- [ ] Validates local paths exist; validates git URLs are reachable (`git ls-remote`); validates URL sources are fetchable
- [ ] Creates `.agentic-usability/` working directory for state
- [ ] Config can be edited manually after creation
- [ ] Typecheck/lint passes

### US-003: Source repo resolver
**Description:** As a developer, I want the tool to resolve local, git remote, and URL sources so the test generation agent has a working directory.

**Acceptance Criteria:**
- [ ] `resolveSource(config)` returns an absolute path to the SDK source on disk
- [ ] For `type: "local"`, validates path exists and returns it (with `subpath` appended if set)
- [ ] For `type: "git"`, clones to `.agentic-usability/repos/<hash>/` with `--depth 1`; supports sparse checkout
- [ ] For `type: "url"`, fetches each URL, converts HTML to markdown, saves to `.agentic-usability/repos/url-<hash>/`
- [ ] Caches git clones and URL fetches; re-fetches when `--fresh` flag is passed
- [ ] Errors clearly if path doesn't exist, clone fails, or URL is unreachable
- [ ] Typecheck/lint passes

### US-004: AI agent adapter interface
**Description:** As a developer, I want a pluggable interface for AI coding agents so any CLI agent can be used.

**Acceptance Criteria:**
- [ ] `AgentAdapter` interface: `{ name: string, execute(prompt: string, workDir: string, env?: Record<string, string>): Promise<AgentResult> }`
- [ ] `AgentResult`: `{ stdout: string, stderr: string, exitCode: number, durationMs: number }`
- [ ] Built-in adapters for: Claude Code (`claude --print -p "..." --workdir <dir>`), Codex CLI, Gemini CLI
- [ ] Custom adapter: takes a shell command template from config, interpolates `{prompt}` and `{workDir}`
- [ ] All adapters spawn the agent as a child process, stream output, enforce a timeout
- [ ] Typecheck/lint passes

---

# Epic 2: Test Suite Generation

The test-generation agent explores the SDK source and produces programming problems. This is the "internal knowledge" phase — the agent has full access to source code, tests, CI config, and examples (or fetched URL content for `url` sources).

## Implementation Details

### How Generation Works

1. The CLI resolves the source repo to a local path (Epic 1 US-003)
2. The configured generator agent is invoked with a structured prompt:
   - System prompt explaining the task: "You are analyzing an SDK. Generate programming problems that exercise its public API."
   - Instruction to examine: exported functions/classes, README, examples/, tests/, CI config
   - Output format: a JSON array matching the `TestCase` schema
   - Difficulty distribution guidance: ~30% easy, ~50% medium, ~20% hard
3. The agent runs in the source directory with full read access (agentic mode — it can `ls`, `cat`, `grep`, explore freely)
4. Output is parsed, validated against the JSON schema, and stored

### Standardized Solution Schema

Both reference (internal) and generated (sandbox) solutions use the same format — a JSON list of files:

```typescript
interface SolutionFile {
  path: string;       // e.g., "src/index.ts"
  content: string;    // file content
}
```

This enables:
- Multi-file solutions (realistic for real-world SDK usage)
- Consistent comparison by both token analysis and LLM judge
- Internal: the test generation agent constructs this as part of each test case
- Public: after the sandbox agent finishes, we extract files from `/workspace/solution/` and build the `SolutionFile[]`

### Test Case Schema

```typescript
interface TestCase {
  id: string;                      // Auto-generated: "TC-001", "TC-002", ...
  problemStatement: string;        // Natural language description of the programming task
  referenceSolution: SolutionFile[]; // Reference implementation as a list of files
  difficulty: "easy" | "medium" | "hard";
  targetApis: string[];            // SDK function/method names (e.g., ["createClient", "query"])
  expectedTokens: string[];       // Broader token list: params, config keys, patterns (e.g., ["timeout", "retryPolicy", "onError"])
  tags: string[];                  // Freeform tags for categorization
  setupInstructions?: string;      // Optional: env setup the sandbox needs before the agent starts
}
```

- `targetApis`: SDK-specific function/method names the solution should use. Used for API coverage scoring.
- `expectedTokens`: Broader set of tokens beyond just API names — parameter names, configuration keys, error handling patterns, import paths, etc. Used for token coverage scoring.

### Prompt Engineering

The generation prompt needs to be carefully structured:
- The agent must produce problems that are **solvable using only public documentation** — even though it can see source code to understand what's possible
- Each problem statement should be self-contained: a developer reading only the problem + public docs should be able to solve it
- The reference solution uses internal knowledge (optimal patterns, edge cases) as the gold standard
- The reference solution must be structured as a `SolutionFile[]` array — one or more files with paths and content

## User Stories

### US-005: Test suite generation command
**Description:** As an SDK author, I want `agentic-usability generate` to produce a test suite by having an AI agent explore my SDK.

**Acceptance Criteria:**
- [ ] Resolves source (local, git, or URL) and invokes the configured generator agent
- [ ] Agent prompt instructs it to: explore the codebase, identify public API surface, generate problems across difficulty levels
- [ ] Each test case includes a `referenceSolution` as a `SolutionFile[]` array (list of files)
- [ ] Each test case includes `targetApis` (function names) and `expectedTokens` (params, patterns, config keys)
- [ ] Parses agent output as JSON, validates against `TestCase` schema
- [ ] Saves valid test suite to `.agentic-usability/suite.json`
- [ ] Prints summary: number of problems generated, difficulty breakdown, target APIs covered
- [ ] If agent output is malformed, retries once with a correction prompt; fails with a clear error if still invalid
- [ ] Typecheck/lint passes

### US-006: Test suite review and editing
**Description:** As an SDK author, I want to review and edit generated test cases before running them.

**Acceptance Criteria:**
- [ ] After generation, prints each test case summary (ID, difficulty, problem statement first line, target APIs, expected tokens count)
- [ ] `agentic-usability edit` opens the suite JSON in `$EDITOR`
- [ ] On save, re-validates the JSON schema and reports errors
- [ ] Individual test cases can be removed or modified without re-generating the entire suite
- [ ] Typecheck/lint passes

### US-007: Export and import test suites
**Description:** As an SDK author, I want to export/import test suites as JSON for version control and sharing.

**Acceptance Criteria:**
- [ ] `agentic-usability export --output suite.json` writes the test suite to a specified path
- [ ] `agentic-usability import --input suite.json` loads and validates a test suite
- [ ] JSON schema validated on import with clear error messages per field
- [ ] Import overwrites the current suite (with confirmation prompt)
- [ ] Typecheck/lint passes

---

# Epic 3: Sandbox Execution (OpenSandbox)

Runs each test case in an isolated OpenSandbox container. The AI agent inside the sandbox receives only the problem statement and public documentation — never the reference solution or source code. The sandbox provides a realistic environment (installed SDK, docs in package, install scripts) for the agent to work in.

## Implementation Details

### OpenSandbox Integration

We use the `@alibaba-group/opensandbox` TypeScript SDK to manage sandboxes. Key API surface:

```typescript
import { ConnectionConfig, Sandbox } from "@alibaba-group/opensandbox";

// Connect to OpenSandbox server (user must run `opensandbox-server` locally or remotely)
const config = new ConnectionConfig({
  domain: "localhost:8080",    // From .agentic-usability.json
  apiKey: "...",               // From config or OPEN_SANDBOX_API_KEY env var
});

// Create an isolated sandbox per test case
const sandbox = await Sandbox.create({
  connectionConfig: config,
  image: "node:20-slim",       // From target config
  timeoutSeconds: 600,         // From config
  env: {
    ANTHROPIC_API_KEY: "...",  // Agent credentials passed through
  },
});

// Upload problem statement and context files
await sandbox.files.writeFiles([
  { path: "/workspace/PROBLEM.md", data: problemStatement, mode: 644 },
  { path: "/workspace/DOCS.md", data: publicDocsContent, mode: 644 },
]);

// Install the AI agent CLI inside the sandbox
await sandbox.commands.run("npm install -g @anthropic-ai/claude-code");

// Run the agent inside the sandbox with the problem prompt
const result = await sandbox.commands.run(
  `cd /workspace && claude --print -p "Read PROBLEM.md and solve it. Use DOCS.md for reference. Write your solution in /workspace/solution/"`
);

// Extract generated solution files → SolutionFile[]
const solutionFiles = await extractSolution(sandbox, "/workspace/solution/");

// Clean up
await sandbox.kill();
await sandbox.close();
```

### Workspace Scaffolding (Layered)

The sandbox workspace is built up in 4 layers, each optional. This lets users control exactly what the AI agent starts with — from a bare container to a fully scaffolded project.

**Layer 1: Container Image** (config: `targets[].image`)
The base Docker image. Users can use stock images (`node:20-slim`, `python:3.12`) or build a custom image with their SDK pre-installed.

```dockerfile
# Example: custom image with SDK pre-installed
FROM node:20-slim
RUN npm install -g my-sdk@3.2.0
WORKDIR /workspace
```

Best for: heavy dependencies that are slow to install (native modules, large SDKs, toolchains).

**Layer 2: Workspace Template** (config: `workspace.template`)
A local directory that gets copied into `/workspace/` in the sandbox before anything runs. This is a snapshot of a starter project.

```
templates/node-basic/
  package.json          # { "dependencies": { "my-sdk": "^3.0.0" } }
  tsconfig.json         # TypeScript config
  src/
    index.ts            # Empty or minimal starter file
  .eslintrc.json        # Linting config
```

The template is uploaded via `sandbox.files.writeFiles()` after sandbox creation. All files in the template directory are recursively uploaded to `/workspace/`.

Best for: boilerplate that every test case needs (project config, tsconfig, linting rules, folder structure).

**Layer 3: Global Setup Script** (config: `workspace.setupScript`)
A shell script that runs inside the sandbox after the template is copied but before the agent starts. Runs once per sandbox.

```bash
#!/bin/bash
# setup.sh
cd /workspace
npm install              # Install deps from template's package.json
echo "Workspace ready"
```

Best for: dynamic setup that can't be baked into an image or template (installing deps, generating lock files, fetching config).

**Layer 4: Per-Test-Case Setup** (test case field: `setupInstructions`)
Optional shell commands specific to a single test case, defined in the test suite JSON. Runs after the global setup.

```json
{
  "id": "TC-007",
  "problemStatement": "Build a real-time dashboard using the streaming API...",
  "setupInstructions": "npm install express socket.io && mkdir -p src/routes"
}
```

Best for: extra dependencies or scaffolding that only certain problems need.

**Execution order inside the sandbox:**
```
1. Container starts (Layer 1: image)
2. Template files copied to /workspace/ (Layer 2: template)
3. Global setup.sh runs (Layer 3: setup script)
4. Per-test setup commands run (Layer 4: per-test setup)
5. PROBLEM.md + DOCS.md injected
6. AI agent starts working
```

**Environment variables** from `workspace.env` are merged into the sandbox environment alongside any agent credential env vars (like `ANTHROPIC_API_KEY`). These are available to all layers.

### Execution Flow Per Test Case

1. **Create sandbox** with the target's container image and merged env vars
2. **Upload template**: recursively copy `workspace.template` directory to `/workspace/` (if configured)
3. **Run global setup**: execute `workspace.setupScript` inside the sandbox (if configured)
4. **Run per-test setup**: execute `testCase.setupInstructions` (if present)
5. **Inject files**: `PROBLEM.md` (problem statement), `DOCS.md` (fetched/cached public docs)
6. **Install agent**: install the AI coding agent CLI inside the container
7. **Execute agent**: run the agent with a prompt directing it to read `PROBLEM.md`, consult `DOCS.md`, and write solution code to `/workspace/solution/`
8. **Extract solution**: download all files from `/workspace/solution/`, build `SolutionFile[]` JSON, save to results
9. **Destroy sandbox**: clean up the container

### Solution Extraction

After the agent finishes, we extract files from `/workspace/solution/` and construct the standardized `SolutionFile[]`:

```typescript
async function extractSolution(sandbox: Sandbox, solutionPath: string): Promise<SolutionFile[]> {
  const files = await sandbox.files.list(solutionPath);
  const solution: SolutionFile[] = [];
  for (const file of files) {
    const content = await sandbox.files.readFile(file.path);
    solution.push({
      path: file.path.replace(solutionPath + "/", ""),
      content,
    });
  }
  return solution;
}
```

The extracted `SolutionFile[]` is saved to `.agentic-usability/results/<test-id>/generated-solution.json`.

### Concurrency

Multiple sandboxes run in parallel (configurable, default 3). Use a simple worker pool:
- Queue of test cases
- N workers, each creates a sandbox, runs a test, extracts solution, destroys sandbox
- If a sandbox creation fails (e.g., OpenSandbox server at capacity), retry with backoff

### Public Docs Injection

The `DOCS.md` file is assembled from the `publicInfo` config:
- Fetch the `docsUrl` (HTML → markdown conversion)
- Fetch each URL in `guides[]`
- Include `additionalContext` string
- Cache fetched docs to avoid re-downloading on every test case
- If docs are too large (>100KB), truncate with a note pointing the agent to the URL

### Prerequisites

The user must have an OpenSandbox server running:
```bash
pip install opensandbox-server
opensandbox-server init-config ~/.sandbox.toml --example docker
opensandbox-server
```
The CLI should validate connectivity on `execute` and print a helpful error with setup instructions if unreachable.

## User Stories

### US-008: OpenSandbox client wrapper
**Description:** As a developer, I want a wrapper around the OpenSandbox TypeScript SDK that handles sandbox lifecycle for our use case.

**Acceptance Criteria:**
- [ ] `SandboxClient` class wraps `@alibaba-group/opensandbox` with: `create(image, env, timeout)`, `uploadFiles(files)`, `runCommand(cmd)`, `downloadFiles(path)`, `destroy()`
- [ ] Validates OpenSandbox server connectivity on first call; throws descriptive error with setup instructions if unreachable
- [ ] Handles sandbox state transitions: waits for `Running` state after creation (poll with timeout)
- [ ] All OpenSandbox errors wrapped in our own error types with actionable messages
- [ ] Typecheck/lint passes

### US-009: Public docs fetcher and cacher
**Description:** As a developer, I want public documentation fetched and cached so sandbox agents have reference material.

**Acceptance Criteria:**
- [ ] Fetches URLs from `publicInfo.docsUrl` and `publicInfo.guides[]`, converts HTML to markdown
- [ ] Caches fetched docs in `.agentic-usability/cache/docs/` with URL-based filenames
- [ ] Cache TTL configurable (default: 24 hours); `--fresh-docs` flag bypasses cache
- [ ] Assembles a single `DOCS.md` from all sources + `additionalContext`
- [ ] Truncates to 100KB with a pointer to the full URL if too large
- [ ] Typecheck/lint passes

### US-010: Workspace scaffolding
**Description:** As an SDK author, I want to configure how the sandbox workspace is prepared before the AI agent starts, so the agent doesn't have to start from an empty folder.

**Acceptance Criteria:**
- [ ] **Layer 1 (Image):** Sandbox uses the target's `image` — user can provide a custom image with pre-installed SDK
- [ ] **Layer 2 (Template):** If `workspace.template` is set, recursively upload that directory to `/workspace/` via `sandbox.files.writeFiles()`
- [ ] **Layer 3 (Global Setup):** If `workspace.setupScript` is set, upload and execute it inside the sandbox (fail the test case if it exits non-zero)
- [ ] **Layer 4 (Per-Test Setup):** If `testCase.setupInstructions` is set, execute those commands inside the sandbox after global setup
- [ ] `workspace.env` vars merged into sandbox environment
- [ ] Each layer is optional — works with none, some, or all configured
- [ ] Setup steps logged to `.agentic-usability/results/<test-id>/setup.log` for debugging
- [ ] Typecheck/lint passes

### US-011: Sandbox test executor
**Description:** As an SDK author, I want `agentic-usability execute` to run each test case in an isolated OpenSandbox container with an AI agent.

**Acceptance Criteria:**
- [ ] For each test case: creates sandbox → scaffolds workspace (US-010 layers) → uploads `PROBLEM.md` + `DOCS.md` → installs agent → runs agent → extracts solution
- [ ] Agent receives ONLY: problem statement, public docs, system prompt, and scaffolded workspace — never the reference solution
- [ ] After agent finishes, extracts files from `/workspace/solution/` → builds `SolutionFile[]` JSON
- [ ] Saves generated solution to `.agentic-usability/results/<test-id>/generated-solution.json`
- [ ] Saves agent output to `.agentic-usability/results/<test-id>/agent-output.log`
- [ ] Configurable concurrency (default: 3 parallel sandboxes)
- [ ] Per-test-case timeout (from config, default: 10 minutes)
- [ ] Progress displayed: `[3/20] TC-003 (medium) — running...` with elapsed time
- [ ] Failed sandboxes logged and skipped (don't halt the entire run)
- [ ] Sandboxes destroyed after solution files are extracted
- [ ] Typecheck/lint passes

### US-012: Execution concurrency manager
**Description:** As a developer, I want a worker pool that runs sandbox executions in parallel with configurable concurrency.

**Acceptance Criteria:**
- [ ] Worker pool accepts a queue of test cases and a concurrency limit
- [ ] Each worker processes one test case at a time (create sandbox → run → extract → destroy)
- [ ] Failed sandbox creations retry up to 2 times with exponential backoff
- [ ] Overall progress tracked: completed, running, queued, failed counts
- [ ] Graceful shutdown: on SIGINT, finish running sandboxes but don't start new ones
- [ ] Typecheck/lint passes

---

# Epic 4: Code Token Analysis

A deterministic, regex-based scoring mechanism that checks whether the generated solution contains expected SDK tokens — API function names, parameters, configuration keys, and patterns.

## Implementation Details

### How It Works

Each test case defines two token lists:
- `targetApis`: SDK function/method names (e.g., `["createClient", "query", "subscribe", "close"]`)
- `expectedTokens`: Broader patterns (e.g., `["timeout", "retryPolicy", "onError", "import.*my-sdk"]`)

For each generated solution, we scan all files for these tokens:

```typescript
function analyzeTokens(
  solution: SolutionFile[],
  targetApis: string[],
  expectedTokens: string[]
): TokenAnalysis {
  const allContent = solution.map(f => f.content).join("\n");

  const apiResults = targetApis.map(api => ({
    token: api,
    found: new RegExp(`\\b${escapeRegex(api)}\\b`).test(allContent),
    foundIn: solution.find(f => new RegExp(`\\b${escapeRegex(api)}\\b`).test(f.content))?.path,
  }));

  const tokenResults = expectedTokens.map(token => ({
    token,
    found: new RegExp(token).test(allContent),
    foundIn: solution.find(f => new RegExp(token).test(f.content))?.path,
  }));

  return {
    apis: apiResults,
    tokens: tokenResults,
    apiCoverage: (apiResults.filter(r => r.found).length / apiResults.length) * 100,
    tokenCoverage: (tokenResults.filter(r => r.found).length / tokenResults.length) * 100,
  };
}
```

### Token Matching Rules

- `targetApis` use word-boundary matching (`\b`) to avoid false positives (e.g., `query` shouldn't match `querySelector`)
- `expectedTokens` support full regex syntax for more flexible matching (e.g., `import.*my-sdk` matches various import styles)
- Matching is case-sensitive by default (SDK APIs are typically case-sensitive)
- All solution files are searched (not just the entry point)

### TokenAnalysis Type

```typescript
interface TokenResult {
  token: string;
  found: boolean;
  foundIn?: string;    // file path where the token was found
}

interface TokenAnalysis {
  testId: string;
  target: string;
  apis: TokenResult[];
  tokens: TokenResult[];
  apiCoverage: number;     // % of targetApis found (0-100)
  tokenCoverage: number;   // % of expectedTokens found (0-100)
}
```

## User Stories

### US-013: Code token analysis command
**Description:** As an SDK author, I want `agentic-usability analyze` to check generated solutions for expected SDK API calls and patterns.

**Acceptance Criteria:**
- [ ] For each test case, loads the generated `SolutionFile[]` from results
- [ ] Scans all solution files for `targetApis` (word-boundary regex) and `expectedTokens` (full regex)
- [ ] Calculates per-test API coverage (%) and token coverage (%)
- [ ] Saves `TokenAnalysis` to `.agentic-usability/results/<test-id>/token-analysis.json`
- [ ] Prints summary: `TC-001: API 100% (3/3), Tokens 85% (6/7)`
- [ ] Handles missing solution files gracefully (0% coverage, logged warning)
- [ ] Typecheck/lint passes

---

# Epic 5: LLM Judge Comparison

A holistic scoring mechanism where an LLM compares the reference solution (from internal source knowledge) against the AI-generated solution (from public-only knowledge). This reveals documentation gaps at a higher level than token analysis.

## Implementation Details

### Judge Prompt

```
You are evaluating two implementations of the same programming task.
Both solutions are provided as a list of files (path + content).

**Task:**
{problemStatement}

**Reference Solution** (written with internal SDK knowledge):
{referenceSolutionFormatted}

**Generated Solution** (written with only public documentation):
{generatedSolutionFormatted}

Evaluate the generated solution against the reference. Score on:
1. **Functional equivalence** (0-100): Does it achieve the same outcome?
2. **API usage correctness** (0-100): Does it use the SDK APIs correctly?
3. **Idiomatic usage** (0-100): Does it follow SDK best practices and patterns?

Respond in JSON:
{
  "functionalEquivalence": <number>,
  "apiCorrectness": <number>,
  "idiomaticUsage": <number>,
  "overallSimilarity": <number>,
  "functionalMatch": <boolean>,
  "notes": "<brief explanation of key differences>"
}
```

Where `referenceSolutionFormatted` and `generatedSolutionFormatted` render the `SolutionFile[]` as:
```
--- File: src/index.ts ---
import { Client } from 'my-sdk';
...

--- File: src/config.ts ---
export const config = { ... };
```

### Judge Uses the Agent Adapter

The judge is just another agent invocation. It uses the `agents.judge` config, which could be Claude, GPT-4, Gemini, or any CLI agent. The prompt is sent and JSON output is parsed.

### JudgeScore Type

```typescript
interface JudgeScore {
  testId: string;
  target: string;
  functionalEquivalence: number;   // 0-100
  apiCorrectness: number;          // 0-100
  idiomaticUsage: number;          // 0-100
  overallSimilarity: number;       // 0-100 (weighted average)
  functionalMatch: boolean;        // true if functionalEquivalence >= 70
  notes: string;                   // explanation of key differences
}
```

## User Stories

### US-014: LLM judge comparison command
**Description:** As an SDK author, I want `agentic-usability judge` to compare reference and generated solutions using an LLM.

**Acceptance Criteria:**
- [ ] For each test case, sends both `SolutionFile[]` (reference and generated) to the configured judge agent
- [ ] Judge prompt includes: problem statement, both solutions formatted as file lists
- [ ] Parses judge output as JSON with scores: `functionalEquivalence`, `apiCorrectness`, `idiomaticUsage`, `overallSimilarity`, `functionalMatch`, `notes`
- [ ] Skippable via `--skip-judge` flag on `run` command
- [ ] Saves judge results to `.agentic-usability/results/<test-id>/judge.json`
- [ ] Retries once if judge output is malformed JSON
- [ ] Typecheck/lint passes

---

# Epic 6: Reporting & Scorecard

Terminal-based reporting that surfaces actionable insights for SDK authors.

## Implementation Details

### Terminal Output Example

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│                          Agentic Usability Scorecard                              │
│                          SDK: my-sdk | Agent: claude-code | Target: node          │
├──────────┬────────────┬──────────────┬────────────────┬────────────┬──────────────┤
│ Test ID  │ Difficulty │ API Coverage │ Token Coverage │ Similarity │ Problem      │
├──────────┼────────────┼──────────────┼────────────────┼────────────┼──────────────┤
│ TC-001   │ easy       │ 100% (3/3)   │ 85% (6/7)      │ 92%        │ Create a...  │
│ TC-002   │ easy       │ 100% (2/2)   │ 80% (4/5)      │ 85%        │ List all...  │
│ TC-003   │ medium     │ 50% (2/4)    │ 40% (4/10)     │ 45%        │ Stream ev... │
│ TC-004   │ medium     │ 75% (3/4)    │ 70% (7/10)     │ 78%        │ Batch up...  │
│ TC-005   │ hard       │ 20% (1/5)    │ 30% (3/10)     │ 30%        │ Custom mi... │
├──────────┴────────────┴──────────────┴────────────────┴────────────┴──────────────┤
│ AGGREGATE                                                                         │
│   Avg API coverage:   69%                                                         │
│   Avg token coverage: 61%                                                         │
│   Avg similarity:     66%                                                         │
│   By difficulty:  easy 88% | medium 48% | hard 30%  (avg similarity)              │
│                                                                                   │
│ WORST PERFORMING APIs                                                             │
│   streamEvents   — found in 0/2 solutions                                         │
│   createMiddleware — found in 0/1 solutions                                       │
│   subscribe      — found in 1/3 solutions                                         │
│                                                                                   │
│ MISSED TOKENS                                                                     │
│   retryPolicy — found in 0/3 solutions                                            │
│   onError     — found in 1/4 solutions                                            │
└───────────────────────────────────────────────────────────────────────────────────┘
```

## User Stories

### US-015: Scorecard reporting command
**Description:** As an SDK author, I want `agentic-usability report` to display a clear scorecard in my terminal.

**Acceptance Criteria:**
- [ ] Reads all results from `.agentic-usability/results/`
- [ ] Displays per-test-case table: ID, difficulty, API coverage, token coverage, similarity score, problem summary
- [ ] Aggregate metrics: average API coverage, average token coverage, average similarity, breakdown by difficulty and by target
- [ ] "Worst performing APIs" section: ranked by miss rate across solutions using `targetApis` metadata
- [ ] "Missed tokens" section: most frequently missing `expectedTokens` across solutions
- [ ] Multi-target runs show a separate section per target
- [ ] `--json` flag outputs raw results as JSON instead of the table
- [ ] Typecheck/lint passes

### US-016: Results JSON export
**Description:** As an SDK author, I want to export full results as JSON for further analysis or CI integration.

**Acceptance Criteria:**
- [ ] `agentic-usability export-results --output results.json` writes all results
- [ ] Includes: test cases, generated solutions, token analysis, judge scores, agent logs, metadata
- [ ] JSON is self-contained (can be imported into another tool or analyzed with `jq`)
- [ ] Typecheck/lint passes

---

# Epic 7: Full Pipeline Orchestration

Ties all epics together into a single `run` command with state persistence and resumability.

## Implementation Details

### Pipeline State Machine

```
INIT → GENERATING → GENERATED → EXECUTING → EXECUTED → ANALYZING → ANALYZED → JUDGING → JUDGED → DONE
```

State is persisted to `.agentic-usability/pipeline-state.json`:
```json
{
  "stage": "EXECUTING",
  "startedAt": "2026-03-31T10:00:00Z",
  "testCases": 20,
  "completed": {
    "generate": true,
    "execute": { "done": 12, "total": 20 },
    "analyze": { "done": 0, "total": 20 },
    "judge": { "done": 0, "total": 20 }
  }
}
```

### Resumability

If the pipeline is interrupted (Ctrl+C, crash, timeout), `agentic-usability run --resume` picks up from the last completed stage. Already-completed test cases are skipped in the execute/analyze/judge stages.

### Pipeline Options

```bash
# Full pipeline
agentic-usability run

# Resume interrupted run
agentic-usability run --resume

# Skip optional stages
agentic-usability run --skip-judge

# Run specific stages only
agentic-usability generate
agentic-usability execute
agentic-usability analyze
agentic-usability judge
agentic-usability report
```

## User Stories

### US-017: Pipeline orchestration command
**Description:** As an SDK author, I want `agentic-usability run` to execute the full pipeline end-to-end.

**Acceptance Criteria:**
- [ ] Runs: generate → execute → analyze → judge → report (in sequence)
- [ ] Stage transitions displayed clearly: `[Stage 2/5] Executing test cases...`
- [ ] Pipeline state persisted after each test case completes
- [ ] `--resume` flag continues from last checkpoint
- [ ] `--skip-judge` skips the judge stage
- [ ] Errors in individual test cases are logged but don't halt the pipeline
- [ ] Final output is the scorecard (same as `report` command)
- [ ] Typecheck/lint passes

### US-018: Pipeline state persistence
**Description:** As a developer, I want pipeline state saved to disk so runs can be resumed after interruption.

**Acceptance Criteria:**
- [ ] State file: `.agentic-usability/pipeline-state.json`
- [ ] Updated after each test case completes (not just after each stage)
- [ ] Tracks: current stage, per-test-case completion status, timestamps, errors
- [ ] `--resume` reads state and skips already-completed work
- [ ] `--fresh` flag ignores existing state and starts from scratch (with confirmation prompt)
- [ ] Typecheck/lint passes

---

# Functional Requirements

- FR-1: The CLI must be installable via `npm install -g agentic-usability`
- FR-2: `init` must create a project config via interactive prompts, supporting local path, git remote, and URL source types
- FR-3: `generate` must invoke a configured AI agent with full read access to the SDK source to produce test cases as JSON
- FR-4: Test suites must be serializable to/from JSON with schema validation
- FR-5: `execute` must create an isolated OpenSandbox container per test case, injecting only the problem statement and public docs
- FR-6: The sandbox AI agent must never receive the reference solution or SDK source code
- FR-7: After sandbox execution, solution files must be extracted and saved as `SolutionFile[]` JSON
- FR-8: `analyze` must perform regex-based token analysis comparing generated solutions against `targetApis` and `expectedTokens`
- FR-9: `judge` must send both solutions (as `SolutionFile[]`) to an LLM and parse structured comparison scores
- FR-10: `report` must display a terminal-formatted scorecard with per-problem and aggregate metrics (API coverage, token coverage, similarity)
- FR-11: `run` must orchestrate the full pipeline with per-test-case state persistence and resumability
- FR-12: All AI agent interactions must go through the `AgentAdapter` interface — no hardcoded provider calls
- FR-13: Concurrent sandbox execution with configurable parallelism (default: 3)
- FR-14: Source resolving must support local paths, git remotes (shallow clone, sparse checkout, SSH/HTTPS), and URLs (fetch + HTML-to-markdown)

# Non-Goals

- No web UI or dashboard — CLI only for v1
- No hosted/cloud benchmark service — runs locally (user manages their own OpenSandbox server)
- No automatic SDK fix suggestions — the tool identifies problems, not solutions
- No build/compile scoring — scoring is token-based and LLM-judge-based to avoid false negatives from environment setup issues
- No GitHub Actions integration — all execution happens in OpenSandbox containers
- No built-in CI/CD integration (users can wrap the CLI in their own CI)
- No support for non-CLI AI agents (e.g., API-only models without agentic shell capabilities)
- No OpenSandbox server management — user installs and runs it separately

# Technical Considerations

- **Language:** TypeScript, ESM modules, Node.js >= 20
- **CLI Framework:** `commander` for command parsing
- **OpenSandbox SDK:** `@alibaba-group/opensandbox` — requires user to run `opensandbox-server` (Docker runtime)
- **Persistence:** JSON files in `.agentic-usability/` directory
- **Agent Adapters:** Shell-based via `child_process.spawn` — agents must support non-interactive prompt mode
- **Concurrency:** Promise-based worker pool for parallel sandbox execution
- **HTML-to-Markdown:** For converting fetched public docs and URL sources (e.g., `turndown` library)
- **Terminal UI:** `chalk` for colors, `cli-table3` for tables, `ora` for spinners

# Success Metrics

- SDK authors can run a full benchmark pipeline with a single `agentic-usability run` command
- Token coverage metric identifies which specific SDK APIs and patterns AI agents miss
- LLM judge scores correlate with documentation quality (better docs → higher similarity)
- Tool works with at least 3 different AI coding agents (Claude Code, Codex, Gemini CLI) without code changes
- A 20-test-case benchmark completes within 60 minutes (dominated by AI agent execution time)
- Pipeline resumes correctly after interruption

# Open Questions

- Should we support partial re-runs (e.g., re-execute only failed test cases)? → Likely yes, low-cost addition to the resumability system
- How do we handle rate limiting from AI providers during large benchmark runs? → Configurable delay between executions; exponential backoff on 429s
- Should the LLM judge use a different model than the solution generator (to avoid bias)? → Recommended but not enforced; config allows different agents per role
- What container images should we ship as defaults? → Document recommended images per runtime, don't bundle them
- How should SDK dependencies get into the sandbox? → Via workspace scaffolding layers (custom image, template, or setup script)
- OpenSandbox has no persistent storage — is ephemeral-per-test-case acceptable? → Yes, each test case is independent; solutions are extracted before sandbox destruction
