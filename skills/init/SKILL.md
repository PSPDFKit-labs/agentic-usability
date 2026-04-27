---
name: init
description: Initialize a new agentic-usability benchmark pipeline project. Use when setting up a new SDK benchmark, creating a config.json, or starting a new evaluation project.
argument-hint: "[project-directory]"
disable-model-invocation: true
allowed-tools: Bash(agentic-usability *) Write Read Glob
---

# Initialize Pipeline Project

Set up a new agentic-usability benchmark pipeline in the given project directory.

```!
echo "Project directory: $ARGUMENTS"
```

You have two approaches:

## Option 1: Interactive Wizard

Run `agentic-usability init -p $ARGUMENTS` for a step-by-step interactive setup.

## Option 2: Direct Config Creation

If the user has described their SDK, create `config.json` directly. This is faster and allows you to tailor the config to their exact setup.

### Project Directory Structure

After init, the project should have:
```
<project>/
  config.json       # Configuration (you create this)
  suite.json        # Test suite (created by generate)
  results/          # Run results (created by eval/execute)
  cache/repos/      # Git repo cache (created automatically)
```

### config.json Schema

```json
{
  "privateInfo": [],
  "publicInfo": [],
  "agents": {},
  "targets": [],
  "sandbox": {}
}
```

#### `privateInfo` (required, non-empty array)

SDK source code and internal docs. Visible to generator and judge, **never to executor**. Each entry is a SourceConfig with a `type` discriminator:

**Local source** — filesystem path:
```json
{ "type": "local", "path": "./src", "subpath": "packages/core", "additionalContext": "Focus on the Builder API" }
```
Fields: `path` (required), `subpath` (optional), `additionalContext` (optional)

**Git source** — clone a repository:
```json
{ "type": "git", "url": "https://github.com/org/sdk.git", "branch": "main", "subpath": "src", "sparse": ["src/api"], "additionalContext": "..." }
```
Fields: `url` (required), `branch`, `subpath`, `sparse` (sparse checkout paths), `additionalContext` (all optional)

**URL source** — fetch documentation:
```json
{ "type": "url", "url": "https://internal-docs.example.com/api-ref", "additionalContext": "..." }
```
Fields: `url` (required), `additionalContext` (optional)

**Package source** — metadata about the SDK package:
```json
{ "type": "package", "name": "@example/sdk", "installCommand": "npm install @example/sdk", "language": "typescript", "additionalContext": "..." }
```
Fields: `name` (required), `installCommand`, `language`, `additionalContext` (all optional)

#### `publicInfo` (optional array)

Public docs and package info visible to **both executor and judge**. Same SourceConfig types as above. Typically includes:
- A `package` source so executors know what to install
- A `url` source for public documentation

#### `agents` (optional object)

| Role | Type | Runs in sandbox? | Secret required? |
|------|------|-------------------|-----------------|
| `generator` | AgentConfig | No (host) | No |
| `executor` | SandboxAgentConfig | **Yes** | **Yes** |
| `judge` | SandboxAgentConfig | **Yes** | **Yes** |
| `insights` | AgentConfig | No (host) | No |

**AgentConfig fields** (generator, insights):
- `command` (required): `"claude"`, `"codex"`, `"gemini"`, or custom CLI name
- `systemPrompt` (optional): supports `{{packageName}}` and `{{docsUrl}}` placeholders

**SandboxAgentConfig** — extends AgentConfig with required `secret`:
```json
{
  "command": "claude",
  "secret": { "value": "$ANTHROPIC_API_KEY" }
}
```

**AgentSecretConfig fields**:
- `value` (required): raw API key or `"$ENV_VAR"` reference
- `envVar`: env var name for key inside sandbox — auto-detected for known agents
- `baseUrl`: API base URL — auto-detected for known agents
- `baseUrlEnvVar`: env var for base URL override — auto-detected for known agents

**Known agent defaults** (auto-filled, user only needs `value`):

| command | envVar | baseUrl | baseUrlEnvVar |
|---------|--------|---------|---------------|
| `claude` | `ANTHROPIC_API_KEY` | `https://api.anthropic.com` | `ANTHROPIC_BASE_URL` |
| `codex` | `OPENAI_API_KEY` | `https://api.openai.com` | `OPENAI_BASE_URL` |
| `gemini` | `GOOGLE_API_KEY` | `https://generativelanguage.googleapis.com` | `GEMINI_API_BASE_URL` |

**Custom agents** must explicitly set `envVar` and `baseUrl` in the secret.

#### `targets` (required, non-empty array)

Docker images for sandboxed execution:
```json
{ "name": "node-20", "image": "node:20-slim", "timeout": 1200, "additionalContext": "Node.js 20 with npm" }
```
Fields: `name` (required), `image` (required), `timeout` (optional, seconds), `additionalContext` (optional, included in generator prompt)

#### `sandbox` (required object, can be `{}`)

```json
{
  "concurrency": 3,
  "defaultTimeout": 600,
  "memoryMib": 2048,
  "cpus": 2,
  "secrets": {
    "EXTRA_API_KEY": {
      "value": "$EXTRA_KEY",
      "allowHosts": ["api.extra-service.com"],
      "allowHostPatterns": ["*.extra-service.com"]
    }
  },
  "env": {
    "LICENSE_KEY": "$MY_LICENSE_KEY"
  }
}
```

- `secrets`: TLS-injected secrets that never enter the VM. Each needs `value` and non-empty `allowHosts`.
- `env`: Plain env vars passed directly into sandbox. Values can use `$VAR` to reference host env.

#### `workspace` (optional)

```json
{ "template": "./workspace-template", "setupScript": "./setup.sh" }
```

For the full schema with all validation rules, see [config-schema.md](../_reference/config-schema.md).

### Complete Example

```json
{
  "privateInfo": [
    { "type": "local", "path": "./sdk-source", "additionalContext": "Main SDK source code" }
  ],
  "publicInfo": [
    { "type": "package", "name": "my-sdk", "installCommand": "npm install my-sdk", "language": "typescript" },
    { "type": "url", "url": "https://docs.my-sdk.io/getting-started" }
  ],
  "agents": {
    "generator": { "command": "claude" },
    "executor": { "command": "claude", "secret": { "value": "$ANTHROPIC_API_KEY" } },
    "judge": { "command": "claude", "secret": { "value": "$ANTHROPIC_API_KEY" } }
  },
  "targets": [
    { "name": "node-20", "image": "node:20-slim", "timeout": 1200 }
  ],
  "sandbox": {
    "concurrency": 3,
    "defaultTimeout": 600
  }
}
```

After creating config.json, run `agentic-usability generate -p <project>` to create the test suite.
