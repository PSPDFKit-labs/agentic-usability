---
name: inspect
description: Open the web UI to visually inspect, edit, and run the benchmark pipeline. Use when the user wants a visual interface for their pipeline.
argument-hint: "[project-directory] [--port 7373]"
disable-model-invocation: true
allowed-tools: Bash(agentic-usability *) Read Glob
---

# Open Web UI

Launch the web-based inspector for the benchmark pipeline.

```!
echo "Arguments: $ARGUMENTS"
```

## Options

- `--port <number>`: Port for the local server (default: 7373)

## Pipeline Folder Structure

The web UI serves data from the project directory:

```
<project>/
  config.json                     # Pipeline configuration
  suite.json                      # Test suite (array of test cases)
  results/
    <runId>/                      # e.g. run-2026-04-25T10-30-00-000Z
      run.json                    # Run manifest (id, targets, testCount, label)
      pipeline-state.json         # Pipeline progress tracker
      report.json                 # Aggregate scorecard (if pipeline completed)
      <target>/<testId>/          # Per-test results
        generated-solution.json   # Agent's solution
        judge.json                # Judge scores
        agent-notes.md            # Agent's working notes
        agent-output.log          # Raw output
        agent-session.jsonl       # Agent conversation log
        judge-session.jsonl       # Judge conversation log
```

## Locating Runs

- All subdirectories in `results/` with a `run.json` are runs
- Latest run is used by default
- Check `pipeline-state.json` to see if a run is complete (`stage: "report"`) or paused

Run `agentic-usability inspect -p $ARGUMENTS` to start the server. It opens the browser automatically. Press Ctrl+C to stop.

For the full file inventory, see [pipeline-guide.md](../_reference/pipeline-guide.md).
