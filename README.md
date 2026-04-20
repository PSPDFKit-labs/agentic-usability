# Agentic Usability

A CLI tool that measures how well AI coding agents (Claude Code, Codex, Gemini CLI, etc.) can use your SDK. It generates programming problems from your SDK source, runs agents in sandboxed environments to solve them, then scores the results using an LLM judge that compares generated solutions against reference implementations.

```
[Source Repo/URL] → [Test Generation Agent] → [Test Suite JSON]
                                                     ↓
        [OpenSandbox] ← [Execution Agent (public info only)]
                                                     ↓
                              [Extract Solution + Workspace Snapshot]
                                                     ↓
                              [OpenSandbox] ← [LLM Judge]
                           (runs solution, inspects source)
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
docker pull opensandbox/code-interpreter:v1.0.2
```

## Installation

```bash
git clone <repo-url>
cd agentic-usability
npm install
npm run build
```

Then run commands via `npx`:

```bash
npx agentic-usability init -p pipelines/my-sdk-eval
```

## Quick Start

### 1. Initialize a project

```bash
npx agentic-usability init -p pipelines/my-sdk-eval
```

The interactive wizard walks you through configuring:
- **Source** — where your SDK code lives (local path, git repo, or URL)
- **Public info** — package name, docs URL, install command (provided to sandbox agents)
- **Agent** — which AI CLI to use (claude, codex, gemini, or custom)
- **Target** — Docker image + timeout for sandbox execution
- **Sandbox** — OpenSandbox server address + environment variables

The wizard explains each field and provides sensible defaults. You can also `cd` into a directory and run `npx agentic-usability init` without `-p`.

### 2. Run the pipeline

```bash
npx agentic-usability eval -p pipelines/my-sdk-eval
```

This runs the evaluation pipeline: **execute → judge → report**.

Or run stages individually:

```bash
npx agentic-usability generate -p pipelines/my-sdk-eval
npx agentic-usability execute  -p pipelines/my-sdk-eval
npx agentic-usability judge    -p pipelines/my-sdk-eval
npx agentic-usability report   -p pipelines/my-sdk-eval
```

Use `--tests` to run specific test cases (comma-separated):

```bash
npx agentic-usability execute -p pipelines/my-sdk-eval --tests TC-001,TC-003
npx agentic-usability judge   -p pipelines/my-sdk-eval --tests TC-001,TC-003
```

## Project Directory Layout

Each pipeline project is a self-contained directory. Without `-p`, the CLI treats CWD as the project directory.

```
pipelines/my-sdk-eval/           # project root (= CWD or -p target)
  config.json                    # pipeline configuration
  suite.json                     # generated test cases
  results/                       # all evaluation runs
    run-2026-04-17T10-30-00-604Z/  # one directory per run
      run.json                   # run metadata (id, label, targets, testCount)
      pipeline-state.json        # resume checkpoint for this run
      report.json                # scorecard export for this run
      node-20/                   # per-target results
        TC-001/
          generated-solution.json
          workspace-snapshot.tar.gz  # sandbox state for judge reconstruction
          agent-cmd.log
          agent-output.log
          agent-proxy.log.json       # executor proxy request logs
          judge.json
          judge-cmd.log
          judge-output.log
          judge-proxy.log.json       # judge proxy request logs
  cache/                         # git repo clones
    repos/
```

Each `eval` invocation creates a new run directory. Previous runs are preserved and browsable in the web UI.

## Commands

| Command | Description | Flags |
|---------|-------------|-------|
| `init` | Create a new pipeline project (interactive wizard) | `-p <dir>` |
| `generate` | Generate test suite from SDK source | `--fresh`, `--non-interactive` |
| `execute` | Run agents in sandboxes to solve test cases | `--tests <ids>`, `--run <runId>` |
| `judge` | LLM comparison of reference vs generated solutions | `--tests <ids>`, `--run <runId>` |
| `report` | Display terminal scorecard | `--json`, `--run <runId>` |
| `eval` | Run evaluation pipeline: execute → judge → report | `--resume`, `--fresh`, `--label <name>`, `--run <runId>` |
| `inspect` | Open web UI to inspect, edit, and run the pipeline | `--port <number>` |
| `insights` | Interactive AI analysis of pipeline results | `--fresh` |

## Configuration Reference

The config file is `config.json` inside the project directory.

### Sources

The `sources` array defines where your SDK code lives. Each entry is resolved independently and all are presented to the generator agent. You can mix source types (e.g. a local OpenAPI spec + a git repo with examples).

#### Local source

Point to an SDK directory or file on your machine:

```json
{
  "sources": [
    {
      "type": "local",
      "path": "/path/to/sdk",
      "subpath": "packages/core",
      "additionalContext": "Focus on the Builder API, ignore legacy v1 namespace"
    }
  ]
}
```

| Field | Description |
|-------|-------------|
| `path` | Absolute or relative path to SDK source directory |
| `subpath` | Scope to a subdirectory (e.g. monorepo package) |
| `additionalContext` | Extra guidance appended to the test generator prompt |

#### Git source

Clone from a remote repository:

```json
{
  "sources": [
    {
      "type": "git",
      "url": "https://github.com/org/sdk.git",
      "branch": "main",
      "subpath": "packages/core",
      "sparse": ["src/", "docs/"]
    }
  ]
}
```

| Field | Description |
|-------|-------------|
| `url` | Git repository URL |
| `branch` | Branch to clone (default: `main`) |
| `subpath` | Scope to a subdirectory after cloning |
| `sparse` | Only download these paths (sparse checkout — saves time on large repos) |
| `additionalContext` | Extra guidance appended to the test generator prompt |

#### URL source

Point the agent to documentation URLs to browse:

```json
{
  "sources": [
    { "type": "url", "url": "https://docs.example.com/api" },
    { "type": "url", "url": "https://docs.example.com/guide" }
  ]
}
```

### Public information

SDK metadata provided to sandbox agents. Documentation URLs are passed directly in the agent prompt so agents can browse them — no pre-fetched docs dump.

```json
{
  "publicInfo": {
    "docsUrl": "https://docs.example.com",
    "guides": ["https://docs.example.com/quickstart"],
    "packageName": "@example/sdk",
    "installCommand": "npm install @example/sdk",
    "language": "python",
    "additionalContext": "Extra context appended to agent prompt"
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
    "judge":     { "command": "claude" },
    "insights":  { "command": "claude" }
  }
}
```

To select a specific model, use `args` with the CLI's model flag. If omitted, each CLI uses its default model.

```json
{
  "agents": {
    "generator": { "command": "claude", "args": ["--model", "claude-sonnet-4-20250514"] },
    "executor":  { "command": "codex",  "args": ["-m", "o3"] },
    "judge":     { "command": "gemini", "args": ["-m", "gemini-2.5-pro"] },
    "insights":  { "command": "claude", "args": ["--model", "claude-opus-4-6"] }
  }
}
```

| CLI | Model flag |
|-----|-----------|
| `claude` | `--model <id>` |
| `codex` | `-m <id>` |
| `gemini` | `-m <id>` |

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

> **Note:** Target images must include `tar` and `base64` utilities. After the executor finishes, the CLI captures a workspace snapshot (`tar czf`) so the judge can restore the exact environment. Most standard images (node, python, ubuntu, alpine) include these by default. If `tar` is missing, the snapshot is silently skipped and the judge falls back to re-scaffolding the workspace from scratch.

### Workspace

Template files and setup scripts for the test workspace:

```json
{
  "workspace": {
    "template": "./templates/workspace",
    "setupScript": "./scripts/setup.sh"
  }
}
```

| Field | Description |
|-------|-------------|
| `template` | Local directory uploaded to `/workspace/` in the sandbox |
| `setupScript` | Script file uploaded and executed during scaffolding |

You can create a `.env` file in your project root (loaded automatically, git-ignored by default):

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

OpenSandbox server connection and agent secrets:

```json
{
  "sandbox": {
    "domain": "localhost:8080",
    "apiKey": "optional-api-key",
    "concurrency": 3,
    "defaultTimeout": 600,
    "systemPrompt": "You are solving a {{packageName}} problem.",
    "env": {
      "ANTHROPIC_API_KEY": "$ANTHROPIC_API_KEY"
    }
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
| `env` | Environment variables for the sandbox container. Known secrets (see below) are routed through a local auth proxy; everything else is passed through as-is. All vars are baked into the container at creation time. |

#### Security: Auth Proxy for Known Secrets

When `sandbox.env` contains a known secret key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_API_KEY`), the CLI automatically:

1. **Strips the real secret** from the container environment
2. **Starts a local auth proxy** on the host that holds the real credentials
3. **Injects `*_BASE_URL`** vars pointing to the proxy, plus a dummy passthrough token

The agent CLI inside the sandbox routes API requests through the proxy, which injects the real credentials on the fly. This way, **real API keys never enter the sandbox** — even if the agent runs `printenv`, it only sees the proxy URL and a dummy token.

> **Warning**: Any env var in `sandbox.env` that is **not** a known secret key is passed through to the container as-is and is visible to agent-generated code (e.g. via `printenv`). Agents routinely inspect their environment. **Rotate any non-proxied credentials after use**, or use `systemPrompt` to instruct the agent not to inspect the environment. Only the known secret keys listed above are protected by the auth proxy.

## Web UI (Inspect)

The `inspect` command launches a local web interface for browsing results, editing test suites, and running pipeline stages:

```bash
npx agentic-usability inspect -p pipelines/my-sdk-eval
# Opens http://localhost:7373 in your browser

npx agentic-usability inspect -p pipelines/my-sdk-eval --port 8888
# Use a custom port
```

The UI includes:
- **Dashboard** — scorecard overview with aggregate metrics per target, scoped to the selected run
- **Runs** — browse, rename, and delete evaluation runs; view per-test-case results with filterable verdicts
- **Suite Editor** — add, edit, and delete test cases with a form-based editor
- **Config Editor** — edit `config.json` with a Monaco JSON editor

A global run selector in the header lets you switch between runs. The selection persists across page navigation.

The server reads and writes directly to the pipeline project directory. Press Ctrl+C in the terminal to stop.

## Insights

The `insights` command launches an interactive AI session pre-loaded with all pipeline results. It helps you interpret benchmark scores, identify SDK usability gaps, and prioritize improvements:

```bash
npx agentic-usability insights -p pipelines/my-sdk-eval
```

The agent is given:
- **Aggregate scores** per target — judge scores, pass rate, and difficulty breakdowns
- **Per-test-case results** — problem statements, scores, verdicts, and judge notes
- **File paths** to generated solutions and judge assessments for deep dives
- **Scoring methodology** — the exact difficulty rubric and judge scoring bands used during evaluation
- **SDK source locations** — so the agent can read your source code and correlate failures with API design

Ask about failure patterns, documentation gaps, API design issues, or request prioritized improvement recommendations. The agent can read any file in the project directory for deeper analysis.

## Pipeline and Resume

The `eval` command orchestrates 3 stages: **execute → judge → report**. Each eval creates a new **run** — an isolated directory under `results/` with its own pipeline state and artifacts. Previous runs are preserved and browsable in the web UI.

```bash
# Basic run
npx agentic-usability eval -p pipelines/my-sdk-eval

# Label a run for easy identification
npx agentic-usability eval -p pipelines/my-sdk-eval --label "baseline v2"

# Resume after interruption (finds latest incomplete run)
npx agentic-usability eval -p pipelines/my-sdk-eval --resume

# Resume a specific run
npx agentic-usability eval -p pipelines/my-sdk-eval --resume --run run-2026-04-17T10-30-00-604Z
```

Run standalone stages against a specific run (defaults to the latest run):

```bash
npx agentic-usability judge  -p pipelines/my-sdk-eval --run run-2026-04-17T10-30-00-604Z
npx agentic-usability report -p pipelines/my-sdk-eval --run run-2026-04-17T10-30-00-604Z
```

## Test Suite Format

The test suite (`suite.json`) is a JSON array of test cases. Difficulty levels have specific meanings:

- **easy** — Task directly demonstrated in public docs/guides/examples. Agent can adapt an existing example.
- **medium** — Uses supported functions with different configs, params, or setups not shown in any guide. Single-function extrapolation.
- **hard** — Combines multiple SDK functions in ways not directly documented. Multi-function extrapolation and orchestration.

```json
[
  {
    "id": "TC-001",
    "problemStatement": "Create a function that...",
    "referenceSolution": [
      { "path": "solution/index.ts", "content": "import { Client } from..." }
    ],
    "difficulty": "medium",
    "tags": ["querying", "filtering"],
    "setupInstructions": "npm install @example/sdk"
  }
]
```

## Scoring

### LLM Judge (Sandboxed)

The judge runs inside a sandbox with the same target image as the executor. It restores the executor's workspace (via snapshot or re-scaffolding), has access to the SDK source code at `/workspace/sources/`, and can run the generated solution to verify it works. It scores across four orthogonal dimensions, focusing on SDK/API usage (not general code style):

| Metric | Description |
|--------|-------------|
| API Discovery | Did the agent find and use the correct SDK endpoints/methods? |
| Call Correctness | Are API calls constructed correctly (parameters, headers, body)? |
| Completeness | Does the solution handle all requirements, edge cases, and errors? |
| Functional Correctness | Does the code actually run and produce correct output? |
| Overall Verdict | Boolean pass/fail — would it pass acceptance tests? |

## Project Structure

```
src/
  core/           types, config, paths, pipeline state, source resolver, suite I/O, results
  agents/         adapter pattern: claude, codex, gemini, custom + spawn utility
  sandbox/        OpenSandbox client, workspace scaffolding, worker pool
  scoring/        LLM judge
  commands/       one file per CLI command
  server/         Express API server + WebSocket for the inspect UI
ui/               React SPA (Vite + Monaco editor), built to dist-ui/
```

## License

ISC
