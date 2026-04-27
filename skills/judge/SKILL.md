---
name: judge
description: Have an LLM judge compare reference and generated solutions, scoring on API discovery, correctness, completeness, and functional correctness.
argument-hint: "[project-directory] [--tests TC-001,TC-002] [--run runId]"
disable-model-invocation: true
allowed-tools: Bash(agentic-usability *) Read Glob
---

# Judge Solutions

Run the judge stage. For each test case and target, an LLM judge compares the reference solution against the generated solution and produces scores.

```!
echo "Arguments: $ARGUMENTS"
```

## Options

- `--tests <ids>`: Comma-separated test case IDs to judge
- `--run <runId>`: Target a specific run (default: latest)

## Scoring Dimensions

Each test case receives scores on:

| Dimension | Range | What it measures |
|-----------|-------|-----------------|
| `apiDiscovery` | 0-100 | Did the agent find the correct SDK endpoints/methods? |
| `callCorrectness` | 0-100 | Are API calls constructed correctly (params, headers, body)? |
| `completeness` | 0-100 | Does the solution handle all requirements? |
| `functionalCorrectness` | 0-100 | Does the code run and produce correct output? |
| `overallVerdict` | boolean | Does the solution actually work? |
| `notes` | string | Brief explanation of scoring decisions |

### Score Bands
- **0-20**: Fundamentally wrong
- **21-40**: Major issues, partially correct
- **41-60**: Mostly correct with notable mistakes
- **61-80**: Correct with minor issues
- **81-100**: Excellent, matches reference

## Judge Output

Written to `results/<runId>/<target>/<testId>/judge.json`:

```json
{
  "testId": "TC-001",
  "target": "node-20",
  "apiDiscovery": 85,
  "callCorrectness": 90,
  "completeness": 75,
  "functionalCorrectness": 80,
  "overallVerdict": true,
  "notes": "Found correct APIs, minor parameter issue in error handling path"
}
```

### DNF (Did Not Finish)

If the executor produced no solution, the judge writes an all-zero score:
```json
{ "apiDiscovery": 0, "callCorrectness": 0, "completeness": 0, "functionalCorrectness": 0, "overallVerdict": false, "notes": "No solution produced (DNF)" }
```

## Per-Test Judge Files

| File | Description |
|------|-------------|
| `judge.json` | Full scoring result |
| `judge-cmd.log` | Judge command executed |
| `judge-output.log` | Raw judge stdout/stderr |
| `judge-session.jsonl` | Judge conversation log (if available) |
| `judge-egress.log.json` | Judge network traffic |
| `judge-error.log` | Error (only on failure) |

## Progress Tracking

Tracked in `results/<runId>/pipeline-state.json`:
- `completed.judge["<target>"]` lists judged test IDs
- State saved after each test — safe to interrupt and resume

Run `agentic-usability judge -p $ARGUMENTS` and report the results.

For detailed internals, see [pipeline-guide.md](../_reference/pipeline-guide.md).
