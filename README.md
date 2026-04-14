# Agentic Usability

A CLI tool that measures how well AI coding agents (Claude Code, Codex, Gemini CLI, etc.) can use your SDK. It generates programming problems from your SDK source, runs agents in sandboxed environments to solve them, then scores the results using regex-based token analysis and LLM judge comparison.

```
[Source Repo/URL] → [Test Generation Agent] → [Test Suite JSON]
                                                     ↓
        [OpenSandbox] ← [Execution Agent (public info only)]
                                                     ↓
                                     [Extract Solution Files JSON]
                                                     ↓
                              ┌──────────────┴──────────────┐
                              ↓                              ↓
                   [Code Token Analysis]          [LLM Judge Comparison]
                   (regex: API coverage)     (holistic: similarity scoring)
                              └──────────────┬──────────────┘
                                             ↓
                                        [Scorecard]
```

## Prerequisites

- **Node.js >= 20**
- **Docker Engine >= 20.10** (OpenSandbox manages containers via Docker)
- **Python 3.10+** with `pip` (for the OpenSandbox server)
- **An AI agent CLI** installed locally for test generation and judging (e.g. Claude Code, Codex, Gemini CLI)
- **API keys** for the agent(s) you plan to use (the sandbox needs these to run agents inside containers)

## Setting Up OpenSandbox

[OpenSandbox](https://github.com/alibaba/OpenSandbox) by Alibaba provides isolated Docker containers where AI agents solve problems. The CLI communicates with OpenSandbox over a REST API.

### 1. Install and start the server

```bash
pip install opensandbox-server

# Generate a config file (uses Docker runtime by default)
opensandbox-server init-config ~/.sandbox.toml --example docker

# Start the server
opensandbox-server
```

The server listens on `localhost:8080` by default.

> **Note:** If you get `command not found` after installing, the Python `bin` directory may not be in your PATH. Run `python3 -m site --user-base` to find it, then add its `bin/` subdirectory to your shell's PATH.

### 2. Verify it's running

```bash
curl http://localhost:8080/health
# → {"status": "healthy"}
```

### 3. Pre-pull target images

Each target in your config references a Docker image. Pre-pull them to avoid slow first-run times:

```bash
docker pull node:20-slim
```

## Installation

```bash
git clone <repo-url>
cd agentic-usability
npm install
npm run build
sudo npm link   # makes `agentic-usability` available globally
```

## Quick Start

### 1. Initialize a project

```bash
agentic-usability init -p pipelines/my-sdk-eval
```

The interactive wizard walks you through configuring:
- **Source** — where your SDK code lives (local path, git repo, or URL)
- **Public info** — package name, docs URL, install command (provided to sandbox agents)
- **Agent** — which AI CLI to use (claude, codex, gemini, or custom)
- **Target** — Docker image + timeout for sandbox execution
- **Sandbox** — OpenSandbox server address + environment variables

The wizard explains each field and provides sensible defaults. You can also `cd` into a directory and run `agentic-usability init` without `-p`.

### 2. Run the pipeline

```bash
agentic-usability run -p pipelines/my-sdk-eval
```

This executes all stages: **generate → execute → analyze → judge → report**.

Or run stages individually:

```bash
agentic-usability generate -p pipelines/my-sdk-eval
agentic-usability execute  -p pipelines/my-sdk-eval
agentic-usability analyze  -p pipelines/my-sdk-eval
agentic-usability judge    -p pipelines/my-sdk-eval
agentic-usability report   -p pipelines/my-sdk-eval
```

## Project Directory Layout

Each pipeline project is a self-contained directory. Without `-p`, the CLI treats CWD as the project directory.

```
pipelines/my-sdk-eval/           # project root (= CWD or -p target)
  config.json                    # pipeline configuration
  suite.json                     # generated test cases
  results/                       # per-target solution files + analysis
    node-20/
      TC-001/
        generated-solution.json
        agent-output.log
        token-analysis.json
        judge.json
  reports/                       # scorecard exports
  logs/                          # pipeline state for resume
    pipeline-state.json
  cache/                         # docs cache + git repo clones
    docs/
    repos/
```

## Commands

All commands accept the global `-p/--project <dir>` option to scope to a project directory.

| Command | Description | Flags |
|---------|-------------|-------|
| `init` | Create a new pipeline project (interactive wizard) | `-p <dir>` |
| `generate` | Generate test suite from SDK source | `--fresh`, `--non-interactive` |
| `execute` | Run agents in sandboxes to solve test cases | `--fresh-docs` |
| `analyze` | Regex-based token analysis of generated solutions | |
| `judge` | LLM comparison of reference vs generated solutions | `--skip-judge` |
| `report` | Display terminal scorecard | `--json` |
| `run` | Full pipeline end-to-end | `--resume`, `--fresh`, `--skip-judge` |
| `edit` | Open test suite in `$EDITOR` | |
| `export` | Export test suite to a file | `--output <path>` (required) |
| `import` | Import test suite from a file | `--input <path>` (required) |
| `export-results` | Export all results to a single JSON file | `--output <path>` (required) |

## Configuration Reference

The config file is `config.json` inside the project directory.

### Source (local)

Point to an SDK directory on your machine:

```json
{
  "source": {
    "type": "local",
    "path": "/path/to/sdk",
    "subpath": "packages/core",
    "additionalContext": "Focus on the Builder API, ignore legacy v1 namespace"
  }
}
```

| Field | Description |
|-------|-------------|
| `path` | Absolute or relative path to SDK source directory |
| `subpath` | Scope to a subdirectory (e.g. monorepo package) |
| `additionalContext` | Extra guidance appended to the test generator prompt |

### Source (git)

Clone from a remote repository:

```json
{
  "source": {
    "type": "git",
    "url": "https://github.com/org/sdk.git",
    "branch": "main",
    "subpath": "packages/core",
    "sparse": ["src/", "docs/"]
  }
}
```

| Field | Description |
|-------|-------------|
| `url` | Git repository URL |
| `branch` | Branch to clone (default: `main`) |
| `subpath` | Scope to a subdirectory after cloning |
| `sparse` | Only download these paths (sparse checkout — saves time on large repos) |
| `additionalContext` | Extra guidance appended to the test generator prompt |

### Source (url)

Fetch documentation pages directly:

```json
{
  "source": {
    "type": "url",
    "urls": ["https://docs.example.com/api", "https://docs.example.com/guide"]
  }
}
```

### Public information

SDK metadata injected into sandboxes. Agents see this as `DOCS.md`:

```json
{
  "publicInfo": {
    "docsUrl": "https://docs.example.com",
    "guides": ["https://docs.example.com/quickstart"],
    "packageName": "@example/sdk",
    "installCommand": "npm install @example/sdk",
    "additionalContext": "Extra context appended to docs"
  }
}
```

### Agents

Each pipeline stage can use a different agent CLI. Supported built-in adapters: `claude`, `codex`, `gemini`. Any other command uses the custom adapter.

```json
{
  "agents": {
    "generator": { "command": "claude" },
    "executor":  { "command": "claude" },
    "judge":     { "command": "claude" }
  }
}
```

### Targets

Docker environments where agents solve problems. Each target runs independently — results are stored per-target.

```json
{
  "targets": [
    { "name": "node-20", "image": "node:20-slim", "timeout": 300 },
    { "name": "python-3.12", "image": "python:3.12-slim", "timeout": 600 }
  ]
}
```

### Workspace

Template files, setup scripts, and environment variables for sandboxes:

```json
{
  "workspace": {
    "template": "./templates/workspace",
    "setupScript": "./scripts/setup.sh",
    "env": {
      "ANTHROPIC_API_KEY": "$ANTHROPIC_API_KEY",
      "NODE_ENV": "production"
    }
  }
}
```

Values in `env` that start with `$` are resolved from your host environment at execution time. This keeps secrets out of your config file. If a referenced variable is not set, execution fails with a clear error.

You can also create a `.env` file in your project root (loaded automatically, git-ignored by default):

```bash
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

#### 1Password support

Instead of storing plain-text secrets in `.env`, you can use [1Password CLI](https://developer.1password.com/docs/cli/) references. Values starting with `op://` are resolved at startup via `op read`:

```bash
# .env — secrets stay in 1Password, never on disk
ANTHROPIC_API_KEY=op://Engineering/Anthropic/api-key
OPENAI_API_KEY=op://Shared/OpenAI/credential
```

Requirements:
- Install the `op` CLI: https://developer.1password.com/docs/cli/get-started/
- Sign in: `op signin`

The resolution happens once at CLI startup. If a reference can't be resolved, the CLI exits with a clear error. Shell environment variables still take precedence over `.env` values (including `op://` references).

### Sandbox

OpenSandbox server connection:

```json
{
  "sandbox": {
    "domain": "localhost:8080",
    "apiKey": "optional-api-key",
    "concurrency": 3,
    "defaultTimeout": 600,
    "systemPrompt": "You are solving a {{packageName}} problem."
  }
}
```

| Field | Description |
|-------|-------------|
| `domain` | OpenSandbox server address |
| `apiKey` | API key if server auth is enabled |
| `concurrency` | Max parallel sandbox instances (default: 3) |
| `defaultTimeout` | Seconds per sandbox if not set per-target (default: 600) |
| `systemPrompt` | Prepended to agent prompt. `{{packageName}}` and `{{docsUrl}}` are interpolated. |

## Pipeline and Resume

The `run` command orchestrates 5 stages: **generate → execute → analyze → judge → report**. Pipeline state is checkpointed after each test case in `logs/pipeline-state.json`.

```bash
# Resume after interruption
agentic-usability run -p pipelines/my-sdk-eval --resume

# Start fresh (clears all state)
agentic-usability run -p pipelines/my-sdk-eval --fresh

# Skip the LLM judge stage (faster, token-analysis only)
agentic-usability run -p pipelines/my-sdk-eval --skip-judge
```

## Test Suite Format

The test suite (`suite.json`) is a JSON array of test cases:

```json
[
  {
    "id": "TC-001",
    "problemStatement": "Create a function that...",
    "referenceSolution": [
      { "path": "solution/index.ts", "content": "import { Client } from..." }
    ],
    "difficulty": "medium",
    "targetApis": ["Client", "Client.query", "QueryBuilder.where"],
    "expectedTokens": ["new Client\\(", "\\.query\\(", "\\.where\\("],
    "tags": ["querying", "filtering"],
    "setupInstructions": "npm install @example/sdk"
  }
]
```

Edit the suite manually with `agentic-usability edit`, or export/import for sharing:

```bash
agentic-usability export -p pipelines/my-sdk-eval --output my-suite.json
agentic-usability import -p pipelines/my-sdk-eval --input my-suite.json
```

## Scoring

### Code Token Analysis

Deterministic regex matching against the generated solution files:

- **API Coverage**: Word-boundary match for each entry in `targetApis`
- **Token Coverage**: Full regex match for each entry in `expectedTokens` (invalid regex falls back to escaped literal)

### LLM Judge

An AI agent compares the reference solution to the generated solution and scores:

| Metric | Description |
|--------|-------------|
| Functional Equivalence | Does the generated code achieve the same outcome? |
| API Correctness | Are the correct SDK APIs used with proper parameters? |
| Idiomatic Usage | Does the code follow SDK conventions and best practices? |
| Overall Similarity | Holistic 0-100% score |
| Functional Match | Boolean pass/fail |

## Project Structure

```
src/
  core/           types, config, paths, pipeline state, source resolver, suite I/O
  agents/         adapter pattern: claude, codex, gemini, custom + spawn utility
  sandbox/        OpenSandbox client, docs fetcher, workspace scaffolding, worker pool
  scoring/        token analysis, LLM judge
  commands/       one file per CLI command
```

## License

ISC
