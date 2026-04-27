# Pipeline Internals Reference

## Folder Structure

```
<project>/
  config.json                          # Project configuration
  suite.json                           # Test suite (array of TestCase)
  results/
    <runId>/                           # e.g. run-2026-04-25T10-30-00-000Z
      run.json                         # Run manifest
      pipeline-state.json              # Progress tracker
      report.json                      # Final scorecard (written by report stage)
      <targetName>/
        <testId>/
          # --- Execute stage outputs ---
          setup.log                    # Workspace scaffolding log
          agent-cmd.log                # Agent command that was executed
          agent-output.log             # Raw agent stdout/stderr
          agent-error.log              # Execution error (only on failure)
          install-error.log            # Agent CLI install failure (only on error)
          generated-solution.json      # Agent's solution files [{path, content}]
          agent-notes.md               # Agent's self-reported working notes
          agent-session.jsonl          # Agent conversation log (if available)
          agent-egress.log.json        # Executor network traffic logs
          workspace-snapshot.tar.gz    # Full sandbox /workspace tarball
          # --- Judge stage outputs ---
          judge.json                   # Judge scoring result
          judge-cmd.log                # Judge command that was executed
          judge-output.log             # Raw judge stdout/stderr
          judge-session.jsonl          # Judge conversation log (if available)
          judge-egress.log.json        # Judge network traffic logs
          judge-error.log              # Judge error (only on failure)
  cache/
    repos/                             # Cloned git repositories (cached)
```

## Run Management

### Run ID Format

Filesystem-safe timestamp: `run-2026-04-25T10-30-00-000Z`

### run.json (Run Manifest)

```json
{
  "id": "run-2026-04-25T10-30-00-000Z",
  "createdAt": "2026-04-25T10:30:00.000Z",
  "targets": ["node-20", "python-3.12"],
  "testCount": 15,
  "label": "baseline v2"
}
```

### Listing Runs

All subdirectories in `results/` that contain a `run.json` are runs. They are sorted newest-first by `createdAt`. The latest run is used by default when `--run` is not specified.

## Pipeline State

### pipeline-state.json

Located at `results/<runId>/pipeline-state.json`. Tracks progress through the pipeline stages.

```json
{
  "stage": "execute",
  "startedAt": "2026-04-25T10:30:00.000Z",
  "testCases": 15,
  "completed": {
    "execute": {
      "node-20": ["TC-001", "TC-002", "TC-003"],
      "python-3.12": ["TC-001"]
    },
    "judge": {
      "node-20": [],
      "python-3.12": []
    }
  }
}
```

### Stage Progression

`execute` → `judge` → `report`

The `stage` field indicates which stage the pipeline is currently in or was in when interrupted.

### Progress Tracking

Progress is tracked **per-stage, per-target, per-test**:
- `completed.execute["node-20"]` = array of test IDs that finished executing for target "node-20"
- `completed.judge["node-20"]` = array of test IDs that finished judging for target "node-20"
- Progress is saved to disk **after each individual test completes** — safe against crashes

## Detecting a Paused/Interrupted Pipeline

A pipeline is paused/resumable when ALL of these are true:

1. `pipeline-state.json` **exists** in a run directory
2. The `stage` field is NOT `"report"` (i.e., it's `"execute"` or `"judge"`)
3. The completed test count for any target is less than `testCases`

Quick checks:
- **No `report.json`** in the run directory → pipeline did not complete
- **`stage: "execute"`** → interrupted during execution
- **`stage: "judge"`** → execution finished, judging was interrupted

### Console indicator

When aborted via Ctrl+C, the last output line is:
> "Pipeline aborted. State saved -- use --resume to continue."

## Resume Mechanics

When `--resume` is passed to `eval`:

1. **Find incomplete run**: Scans all runs in `results/`, finds the latest one where `stage !== "report"`. Or uses `--run <id>` if specified.
2. **Load state**: Reads `pipeline-state.json` from the run directory
3. **Skip completed stages**: If `stage` is `"judge"`, the entire execute stage is skipped
4. **Within-stage resumption**: For each target, computes `allTestIds - completed[stage][target]` to get only remaining tests
5. **Incremental saves**: After each test completes, state is saved immediately

### --fresh flag

Resets `pipeline-state.json` to initial state (stage="execute", empty completed maps) after a confirmation prompt. Does NOT delete result artifact files (agent output, judge scores, etc.).

`--fresh` is only meaningful when combined with `--resume` (and optionally `--run <id>`). Without `--resume`, a new run ID is always generated with clean state, making `--fresh` redundant. With `--resume`, it finds the existing incomplete run (or the one specified by `--run`) and resets its progress tracker so the entire run re-executes from the beginning in the same run directory.

Note: `--run` is also only effective with `--resume` — without it, a new run is always created regardless.

## Abort / Ctrl+C Handling

**First Ctrl+C**: Graceful abort
- Sets `aborted` flag
- Finishes the currently running test (sandbox)
- Stops pulling new tests from the queue
- Saves pipeline state
- Prints resume instructions

**Second Ctrl+C**: Hard exit
- Calls `process.exit(1)` immediately
- Sandbox cleanup may be incomplete

## Scoring Dimensions

Each test case is scored by the judge on these dimensions:

| Dimension | Range | Description |
|-----------|-------|-------------|
| `apiDiscovery` | 0-100 | Did the agent find the correct SDK endpoints/methods? |
| `callCorrectness` | 0-100 | Are API calls constructed correctly (params, headers, body)? |
| `completeness` | 0-100 | Does the solution handle all requirements? |
| `functionalCorrectness` | 0-100 | Does the code run and produce correct output? |
| `overallVerdict` | boolean | Does the solution actually work? |
| `notes` | string | Brief explanation of scoring |

### Score Bands

- **0-20**: Fundamentally wrong
- **21-40**: Major issues, partially correct
- **41-60**: Mostly correct with notable mistakes
- **61-80**: Correct with minor issues
- **81-100**: Excellent, matches reference

### DNF (Did Not Finish)

If the executor produced no `generated-solution.json`, the judge writes an all-zero score:
```json
{
  "testId": "TC-001",
  "target": "node-20",
  "apiDiscovery": 0,
  "callCorrectness": 0,
  "completeness": 0,
  "functionalCorrectness": 0,
  "overallVerdict": false,
  "notes": "No solution produced (DNF)"
}
```

## Execute Stage Details

For each test case and target:
1. Creates a microsandbox Docker container from the target image
2. Scaffolds workspace (template → global setup script → per-test setup)
3. Uploads `PROBLEM.md` with the test case's problem statement
4. Installs the agent CLI (e.g. `npm install -g @anthropic-ai/claude-code`)
5. Uploads public file sources into `/workspace/sources/`
6. Runs the agent with a prompt to read PROBLEM.md and write solution to `/workspace/solution/`
7. Extracts solution files (only `solution__` prefixed files)
8. Saves all output files (see folder structure above)
9. Takes workspace snapshot tarball
10. Destroys sandbox

**Retry behavior**: Up to 2 retries with backoffs of 1s and 3s on failure.

**Concurrency**: Controlled by `sandbox.concurrency` in config (parallel sandbox instances).

## Judge Stage Details

For each test case and target:
1. Loads the `generated-solution.json` from execute stage
2. If no solution → writes DNF score, marks complete, skips
3. Optionally loads `agent-notes.md` for context
4. Runs a sandboxed judge agent with reference solution + generated solution
5. Judge outputs a JudgeScore JSON
6. Saves `judge.json` and related files

## Report Stage

1. Loads all judge scores across targets
2. Computes aggregates: averages for each dimension, pass rate, breakdown by difficulty
3. Prints colored terminal table
4. Writes `report.json` to run directory
