---
name: export
description: Export a benchmark pipeline as a zip file for sharing or archiving. Excludes cache and large snapshots.
argument-hint: "[project-directory] [-o output.zip] [-r runId]"
disable-model-invocation: true
allowed-tools: Bash(agentic-usability *)
---

# Export Pipeline

Export the pipeline project as a zip archive for sharing or archiving.

```!
echo "Arguments: $ARGUMENTS"
```

## Options

- `-o, --output <path>`: Output zip file path (default: `<pipeline-name>-export.zip`)
- `-r, --run <runId>`: Export only a specific run instead of the entire project

## What Gets Exported

The zip includes:
- `config.json` — pipeline configuration
- `suite.json` — test suite
- `results/` — all run results (judge scores, solutions, logs)

## What Gets Excluded

- `cache/**` — git repo clones (can be re-fetched)
- `**/*.tar.gz` — workspace snapshots (large binary files)

## Pipeline Structure

```
<project>/
  config.json
  suite.json
  results/<runId>/
    run.json                    # Run manifest
    pipeline-state.json         # Pipeline state
    report.json                 # Scorecard
    <target>/<testId>/          # Per-test results
```

Run `agentic-usability export -p $ARGUMENTS`.

For the full file inventory, see [pipeline-guide.md](../_reference/pipeline-guide.md).
