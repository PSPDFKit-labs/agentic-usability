---
name: eval
description: Run the full evaluation pipeline (execute, judge, report) for an SDK usability benchmark. Use when running a complete benchmark end-to-end, resuming an interrupted pipeline, or checking pipeline status.
argument-hint: "[project-directory] [--resume] [--fresh] [--label name]"
disable-model-invocation: true
allowed-tools: Bash(agentic-usability *) Read Glob
---

# Run Full Evaluation Pipeline

Run the complete benchmark pipeline: **execute → judge → report**.

```!
echo "Arguments: $ARGUMENTS"
```

## Pipeline Stages

1. **Execute**: For each test case × target, spins up a sandboxed VM, has an AI agent solve the problem, extracts solution files
2. **Judge**: For each test case × target, an LLM judge compares the generated solution to the reference solution and scores it
3. **Report**: Aggregates all judge scores into a terminal scorecard and writes `report.json`

## Options

- `--resume`: Resume from the last checkpoint of an interrupted pipeline
- `--fresh`: Only useful with `--resume`. Resets pipeline state so the run re-executes from scratch in the same run directory. Does NOT delete result files. Without `--resume`, a new run always starts fresh anyway.
- `--label <name>`: Human-readable label for this run
- `--run <runId>`: Only used with `--resume`. Target a specific run instead of auto-detecting the latest incomplete one.

## Detecting Pipeline Status

Before running, you can check if a pipeline is paused/interrupted by reading the pipeline state file:

**Pipeline state location**: `<project>/results/<runId>/pipeline-state.json`

```json
{
  "stage": "execute",
  "startedAt": "2026-04-25T10:30:00.000Z",
  "testCases": 15,
  "completed": {
    "execute": { "node-20": ["TC-001", "TC-002"] },
    "judge": { "node-20": [] }
  }
}
```

**How to check status**:
- `stage` is `"execute"` or `"judge"` → pipeline is incomplete/paused
- `stage` is `"report"` → pipeline completed successfully
- Compare `completed[stage][target].length` vs `testCases` to see progress
- No `report.json` in the run directory → pipeline didn't finish
- List runs: look for subdirectories in `results/` containing `run.json`

**Run manifest** (`results/<runId>/run.json`):
```json
{
  "id": "run-2026-04-25T10-30-00-000Z",
  "createdAt": "2026-04-25T10:30:00.000Z",
  "targets": ["node-20"],
  "testCount": 15,
  "label": "baseline v2"
}
```

## How Resume Works

When `--resume` is passed:
1. Finds the latest incomplete run (where `stage !== "report"`), or uses `--run <id>`
2. Loads the saved pipeline state
3. **Skips completed stages entirely** (e.g., if stage="judge", execute is skipped)
4. **Within a stage**: only runs tests not yet in the `completed` map for each target
5. Progress is saved after **each individual test** — safe against crashes

## Abort Handling

- **First Ctrl+C**: Graceful — finishes current test, saves state, prints "use --resume to continue"
- **Second Ctrl+C**: Hard exit — immediate process termination

## Running the Pipeline

Run `agentic-usability eval -p $ARGUMENTS` and monitor the output. If interrupted, suggest `--resume` to continue.

For detailed pipeline internals, see [pipeline-guide.md](../_reference/pipeline-guide.md).
