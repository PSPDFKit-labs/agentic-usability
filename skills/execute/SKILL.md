---
name: execute
description: Execute benchmark test cases in sandboxed environments with AI agents. Spins up microsandbox containers for each test case and extracts solutions.
argument-hint: "[project-directory] [--tests TC-001,TC-002] [--run runId]"
disable-model-invocation: true
allowed-tools: Bash(agentic-usability *) Read Glob
---

# Execute Test Cases

Run the executor stage of the benchmark pipeline. For each test case and target, this:

1. Creates a sandboxed VM from the target image
2. Scaffolds workspace (template → setup script → per-test setup instructions)
3. Uploads `PROBLEM.md` with the problem statement
4. Installs the agent CLI inside the sandbox
5. Uploads public sources (docs, packages) into `/workspace/sources/`
6. Runs the executor agent to solve the problem
7. Extracts solution files from `/workspace/solution/`
8. Saves all artifacts and destroys the sandbox

```!
echo "Arguments: $ARGUMENTS"
```

## Options

- `--tests <ids>`: Comma-separated test case IDs to run (e.g., `--tests TC-001,TC-003`)
- `--run <runId>`: Target a specific run directory (default: latest run)

## Per-Test Output Files

Saved to `results/<runId>/<target>/<testId>/`:

| File | Description |
|------|-------------|
| `generated-solution.json` | Agent's solution `[{path, content}]` |
| `agent-notes.md` | Agent's self-reported working notes |
| `agent-output.log` | Raw agent stdout/stderr |
| `agent-cmd.log` | Exact command executed |
| `agent-session.jsonl` | Agent conversation log (if available) |
| `agent-egress.log.json` | Network traffic logs |
| `workspace-snapshot.tar.gz` | Full sandbox workspace tarball |
| `setup.log` | Workspace scaffolding log |
| `agent-error.log` | Error details (only on failure) |
| `install-error.log` | Agent install failure (only on error) |

## Progress Tracking

Progress is tracked in `results/<runId>/pipeline-state.json`:
- `completed.execute["<target>"]` lists test IDs that have finished
- State is saved after **each test** — safe to interrupt and resume
- Use `agentic-usability eval --resume` to continue from where it stopped

To check which tests completed, read the pipeline state:
```
results/<runId>/pipeline-state.json → completed.execute.<targetName>
```

## Retry Behavior

Failed tests are retried up to 2 times with backoffs of 1s and 3s before being marked as failed.

## Concurrency

Controlled by `sandbox.concurrency` in config.json. Multiple sandboxes run in parallel.

Run `agentic-usability execute -p $ARGUMENTS` and report the results.

For detailed internals, see [pipeline-guide.md](../_reference/pipeline-guide.md).
