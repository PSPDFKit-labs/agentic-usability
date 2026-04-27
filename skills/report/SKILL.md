---
name: report
description: Display a terminal scorecard of benchmark results showing pass rates, scores by difficulty, and per-test breakdowns. Use when the user asks about benchmark results, scores, or wants to see how their SDK performed.
argument-hint: "[project-directory] [--json] [--run runId]"
allowed-tools: Bash(agentic-usability *) Read Glob
---

# Benchmark Report

Display the benchmark scorecard for the pipeline.

```!
agentic-usability report -p $ARGUMENTS
```

## Options

- `--json`: Output raw structured JSON instead of the colored table
- `--run <runId>`: Show results for a specific run (default: latest)

## Where Results Live

```
results/<runId>/
  report.json                        # Aggregate scorecard
  <targetName>/<testId>/
    judge.json                       # Per-test judge scores
    generated-solution.json          # Agent's solution
    agent-notes.md                   # Agent's working notes
```

## Scoring Dimensions

| Dimension | Range | What it measures |
|-----------|-------|-----------------|
| `apiDiscovery` | 0-100 | Found correct SDK endpoints/methods? |
| `callCorrectness` | 0-100 | API calls constructed correctly? |
| `completeness` | 0-100 | All requirements handled? |
| `functionalCorrectness` | 0-100 | Code runs and produces correct output? |
| `overallVerdict` | boolean | Solution works? (pass/fail) |

The report aggregates these across all test cases and breaks them down by difficulty (easy/medium/hard).

## Finding Runs

Runs are stored as subdirectories in `results/` containing `run.json`:
```json
{ "id": "run-2026-04-25T10-30-00-000Z", "createdAt": "...", "targets": [...], "testCount": 15, "label": "..." }
```

To list all runs, look for `results/*/run.json` files.

Present the results to the user. If they want deeper analysis, suggest using the insights skill.

For detailed file inventory, see [pipeline-guide.md](../_reference/pipeline-guide.md).
