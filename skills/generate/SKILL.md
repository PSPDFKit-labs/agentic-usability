---
name: generate
description: Generate SDK usability test cases by exploring source code. Use when creating benchmark test suites, generating test cases for an SDK, or when the user wants to create evaluation scenarios.
argument-hint: "[project-directory]"
context: fork
allowed-tools: Read Write Glob Grep Bash(*)
---

# Generate Test Suite

You are acting as the test case generator for an SDK usability benchmark. Your task is to explore the SDK source code and produce test cases.

## Output Format

Write a JSON array of test cases to `suite.json` in the project directory. Each test case:

```json
{
  "id": "TC-001",
  "problemStatement": "Goal-oriented task description (no API names/endpoints)",
  "referenceSolution": [{ "path": "solution.py", "content": "..." }],
  "difficulty": "easy|medium|hard",
  "tags": ["auth", "http"],
  "setupInstructions": "pip install some-dep"
}
```

- `problemStatement`: Describe the GOAL, not the implementation. The executor agent must discover the right APIs itself.
- `referenceSolution`: Correct implementation files.
- `difficulty`: easy = documented example, medium = extrapolation, hard = multi-function composition.

## Project Config

The project's `config.json` defines sources, targets, and agents. For the full schema, see [config-schema.md](../_reference/config-schema.md).

## The Full Generator Prompt

The following prompt contains SDK-specific context (source paths, existing tests, schema):

!`agentic-usability generate --prompt-only -p $ARGUMENTS`
