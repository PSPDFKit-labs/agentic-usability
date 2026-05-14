---
name: sandbox
description: Launch an interactive shell inside a microsandbox for debugging. Supports bare mode, executor setup, or judge setup with optional test case scaffolding.
argument-hint: "[project-directory] [--mode executor|judge] [--test TC-001] [--target node-20] [--run runId]"
disable-model-invocation: true
allowed-tools: Bash(agentic-usability *) Read Glob
---

# Debug Sandbox

Launch an interactive shell inside a microsandbox identical to what the pipeline uses. Useful for debugging agent auth, inspecting environment variables, testing commands, and reproducing sandbox issues.

```!
echo "Arguments: $ARGUMENTS"
```

## Modes

By default the sandbox boots with just the target image, secrets, and env vars — no agent install or workspace setup.

### Bare (no flags)

```bash
agentic-usability sandbox -p <project>
```

Boots a sandbox with the configured secrets and env vars. Nothing else is installed or scaffolded.

### Executor mode

```bash
agentic-usability sandbox -p <project> --mode executor
agentic-usability sandbox -p <project> --mode executor --test TC-001
```

Installs the executor agent CLI. With `--test`, also scaffolds the workspace, uploads PROBLEM.md, and uploads public sources — mirroring the `execute` stage setup.

### Judge mode

```bash
agentic-usability sandbox -p <project> --mode judge --test TC-001
agentic-usability sandbox -p <project> --mode judge --test TC-001 --run <runId>
```

Installs the judge agent CLI. With `--test`, restores the workspace snapshot from a previous run (or uploads solution files), uploads all sources (private + public) — mirroring the `judge` stage setup.

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--target <name>` | first in config | Which target image to use |
| `--mode <mode>` | (none) | `executor` or `judge` — installs agent CLI and optionally sets up workspace |
| `--test <id>` | (none) | Test case to scaffold (requires `--mode`) |
| `--run <runId>` | latest | Run to load workspace snapshot from (judge mode) |
| `--output <dir>` | `results/sandbox-debug-<timestamp>/` | Directory to save debug artifacts |

## Interactive Shell

Once inside the sandbox, you have a full shell. Press `Ctrl-]` to detach and destroy the sandbox.

Common debugging tasks:
- `printenv | grep KEY` — check which env vars are set
- `codex login --with-api-key` — test Codex auth
- `cat /workspace/PROBLEM.md` — verify problem statement
- `ls /workspace/sources/` — check uploaded sources

## Artifacts

After detaching, the following artifacts are saved to the output directory:

| File | Description |
|------|-------------|
| `agent-egress.log.json` | Network traffic captured during the session |
| `setup.log` | Scaffolding and agent install output |
| `workspace-snapshot.tar.gz` | Tarball of `/workspace` after session ends |
| `agent-session.jsonl` | Agent CLI session log (if available) |

Run `agentic-usability sandbox -p $ARGUMENTS` and report the results.