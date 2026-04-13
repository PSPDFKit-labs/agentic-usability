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
- **Python 3.10+** with [`uv`](https://docs.astral.sh/uv/) (for the OpenSandbox server)
- **An AI agent CLI** installed locally for test generation and judging (e.g. Claude Code, Codex, Gemini CLI)
- **API keys** for the agent(s) you plan to use (the sandbox needs these to run agents inside containers)

## Setting Up OpenSandbox

[OpenSandbox](https://github.com/alibaba/OpenSandbox) by Alibaba provides isolated Docker containers where AI agents solve problems. The CLI communicates with OpenSandbox over a REST API. See the [JS SDK docs](https://github.com/alibaba/OpenSandbox/tree/main/sdks/sandbox/javascript) for advanced usage.

### 1. Install and start the server

The OpenSandbox server is a Python FastAPI application:

```bash
# Install
uv tool install opensandbox-server
# Or: pip install opensandbox-server

# Generate a config file (uses Docker runtime by default)
opensandbox-server init-config ~/.sandbox.toml --example docker

# Start the server
opensandbox-server
```

The server listens on `localhost:8080` by default. It manages Docker containers for each sandbox instance — you don't need to pull a separate server image.

### 2. Verify it's running

```bash
curl http://localhost:8080/health
# → {"status": "healthy"}
```

API documentation is available at `http://localhost:8080/docs` (Swagger UI).

### 3. Pre-pull target images

Each target in your config references a Docker image. Pre-pull them to avoid slow first-run times:

```bash
docker pull node:20-slim
docker pull python:3.12-slim
```

### Optional: API key authentication

By default, the server runs without authentication (suitable for local development). To enable auth, set `server.api_key` in `~/.sandbox.toml`:

```toml
[server]
api_key = "your-secret-key"
```

Then set the key in your project config under `sandbox.apiKey`, or export `OPEN_SANDBOX_API_KEY` in your environment.

## Installation

```bash
git clone <repo-url>
cd agentic-usability
npm install
npm run build
npm link   # makes `agentic-usability` available globally
```

## Quick Start

### 1. Initialize a project

```bash
agentic-usability init
```

This walks you through creating a `.agentic-usability.json` config file. You'll provide:
- Source type (local path, git remote, or URL)
- SDK package name and docs URL
- Which AI agent to use
- Target environment(s) (Docker image + timeout)
- OpenSandbox server address

### 2. Set up agent API keys

Agents running inside the sandbox need API keys. Copy the example env file and fill in your keys:

```bash
cp .env.example .env
```

Then edit `.env`:

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
```

The `.env` file is loaded automatically on every command. It's in `.gitignore` so your keys stay local.

Then reference them in your config using `$VAR` syntax (see [Environment Variables](#environment-variables)).

### 3. Run the full pipeline

```bash
agentic-usability run
```

This executes all stages in order: generate, execute, analyze, judge, report.

Or run stages individually:

```bash
agentic-usability generate          # Create test suite from SDK source
agentic-usability execute           # Run agents in sandboxes
agentic-usability analyze           # Token coverage analysis
agentic-usability judge             # LLM comparison scoring
agentic-usability report            # Display scorecard
```

## Commands

| Command | Description | Flags |
|---------|-------------|-------|
| `init` | Create a new `.agentic-usability.json` config | |
| `generate` | Generate test suite from SDK source | `--fresh` re-resolve source |
| `execute` | Run agents in sandboxes to solve test cases | `--fresh-docs` bypass doc cache |
| `analyze` | Regex-based token analysis of generated solutions | |
| `judge` | LLM comparison of reference vs generated solutions | `--skip-judge` |
| `report` | Display terminal scorecard | `--json` output as JSON |
| `run` | Full pipeline end-to-end | `--resume`, `--fresh`, `--skip-judge` |
| `edit` | Open test suite in `$EDITOR` | |
| `export` | Export test suite to a file | `--output <path>` (required) |
| `import` | Import test suite from a file | `--input <path>` (required) |
| `export-results` | Export all results to a single JSON file | `--output <path>` (required) |

## Configuration Reference

The config lives in `.agentic-usability.json` at the project root.

```jsonc
{
  // Where the SDK source lives — used by the test generation agent
  "source": {
    "type": "local",              // "local" | "git" | "url"
    "path": "/path/to/sdk",      // for type: "local"
    "url": "https://github.com/org/sdk.git",  // for type: "git"
    "branch": "main",            // for type: "git" (default: "main")
    "subpath": "packages/core",  // scope to monorepo subdirectory
    "sparse": ["src/", "docs/"], // sparse checkout paths (git only)
    "urls": ["https://docs.example.com"]  // for type: "url"
  },

  // Public-facing SDK info — injected into sandbox as DOCS.md
  "publicInfo": {
    "docsUrl": "https://docs.example.com",
    "guides": ["https://docs.example.com/quickstart"],
    "packageName": "@example/sdk",
    "installCommand": "npm install @example/sdk",
    "additionalContext": "Extra context appended to docs"
  },

  // AI agent configuration — each stage can use a different agent
  "agents": {
    "generator": { "command": "claude", "args": [] },
    "executor":  { "command": "claude", "args": [] },
    "judge":     { "command": "claude", "args": [] }
  },

  // Target environments — the sandbox image(s) to test against
  "targets": [
    { "name": "node-20", "image": "node:20-slim", "timeout": 300 },
    { "name": "python-3.12", "image": "python:3.12-slim", "timeout": 300 }
  ],

  // Workspace scaffolding — template, setup, and env vars
  "workspace": {
    "template": "./templates/workspace",  // directory copied into sandbox
    "setupScript": "./scripts/setup.sh",  // runs after template copy
    "env": {
      "ANTHROPIC_API_KEY": "$ANTHROPIC_API_KEY",  // resolved from host
      "NODE_ENV": "production"                     // literal value
    }
  },

  // OpenSandbox server connection
  "sandbox": {
    "domain": "localhost:8080",
    "apiKey": "optional-api-key",
    "concurrency": 3,           // parallel sandbox instances
    "defaultTimeout": 600,      // seconds per sandbox
    "systemPrompt": "You are solving a {{packageName}} problem."
  },

  // Output paths
  "output": {
    "dir": ".agentic-usability",
    "suiteFile": ".agentic-usability/suite.json"
  }
}
```

### Environment Variables

Values in `workspace.env` that start with `$` are resolved at execution time. This keeps secrets out of your config file.

```json
{
  "workspace": {
    "env": {
      "ANTHROPIC_API_KEY": "$ANTHROPIC_API_KEY",
      "MY_CUSTOM_VAR": "$MY_CUSTOM_VAR",
      "STATIC_VALUE": "this-is-literal"
    }
  }
}
```

Resolution order (first match wins):

1. **Shell environment** — `export ANTHROPIC_API_KEY=sk-ant-...`
2. **`.env` file** — loaded automatically from the project root

If a referenced variable is not found in either source, execution fails immediately with a clear error message.

To get started, copy the example file and fill in your keys:

```bash
cp .env.example .env
```

The `.env` file supports `KEY=VALUE` pairs, `#` comments, blank lines, and optional quotes. It is git-ignored by default.

### Multi-Target

Define multiple targets to benchmark the same test suite across different environments:

```json
{
  "targets": [
    { "name": "node-20", "image": "node:20-slim", "timeout": 300 },
    { "name": "node-22", "image": "node:22-slim", "timeout": 300 },
    { "name": "python-3.12", "image": "python:3.12-slim", "timeout": 600 }
  ]
}
```

Each target runs independently. Results are stored per-target:

```
.agentic-usability/results/<target-name>/<test-id>/
  generated-solution.json
  agent-output.log
  token-analysis.json
  judge.json
```

The report displays a separate scorecard per target.

## Pipeline and Resume

The `run` command orchestrates 5 stages: **generate → execute → analyze → judge → report**. Pipeline state is checkpointed after each test case in `.agentic-usability/pipeline-state.json`.

If a run is interrupted (Ctrl+C, crash, timeout), resume from where it left off:

```bash
agentic-usability run --resume
```

To start completely fresh (clears all state):

```bash
agentic-usability run --fresh
```

To skip the LLM judge stage (faster, token-analysis only):

```bash
agentic-usability run --skip-judge
```

## Test Suite Format

The test suite (`.agentic-usability/suite.json`) is a JSON array of test cases:

```json
[
  {
    "id": "test-001",
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

You can manually edit the suite with `agentic-usability edit`, or export/import for sharing:

```bash
agentic-usability export --output my-suite.json
agentic-usability import --input my-suite.json
```

## Scoring

### Code Token Analysis

Deterministic regex matching against the generated solution files:

- **API Coverage**: Word-boundary match for each entry in `targetApis` (e.g. `\bClient.query\b`)
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
  core/           types, config, pipeline state, source resolver, suite I/O
  agents/         adapter pattern: claude, codex, gemini, custom + spawn utility
  sandbox/        OpenSandbox client, docs fetcher, workspace scaffolding, worker pool
  scoring/        token analysis, LLM judge
  commands/       one file per CLI command
```

## License

ISC
