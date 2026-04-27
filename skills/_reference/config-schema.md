# config.json Schema Reference

## Top-Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `privateInfo` | `SourceConfig[]` | **Yes** | Non-empty array. SDK source code / internal docs for test generation. Visible to generator and judge, never to executor. |
| `publicInfo` | `SourceConfig[]` | No | Public docs / package metadata. Visible to executor AND judge. |
| `agents` | `object` | No | Per-role agent configuration. |
| `targets` | `TargetConfig[]` | **Yes** | Non-empty array. Docker images for sandboxed execution. |
| `workspace` | `WorkspaceConfig` | No | Workspace template and setup. |
| `sandbox` | `SandboxConfig` | **Yes** | Must be an object (can be `{}`). Resource limits, secrets, env vars. |

## SourceConfig (discriminated union on `type`)

### LocalSource (`type: "local"`)

| Field | Type | Required |
|-------|------|----------|
| `type` | `"local"` | Yes |
| `path` | `string` | Yes — filesystem path to source |
| `subpath` | `string` | No — scope to subdirectory |
| `additionalContext` | `string` | No — guidance for generator |

### GitSource (`type: "git"`)

| Field | Type | Required |
|-------|------|----------|
| `type` | `"git"` | Yes |
| `url` | `string` | Yes — git repository URL |
| `branch` | `string` | No — defaults to default branch |
| `subpath` | `string` | No — scope to subdirectory |
| `sparse` | `string[]` | No — sparse checkout paths |
| `additionalContext` | `string` | No |

### UrlSource (`type: "url"`)

| Field | Type | Required |
|-------|------|----------|
| `type` | `"url"` | Yes |
| `url` | `string` | Yes — documentation URL |
| `additionalContext` | `string` | No |

### PackageSource (`type: "package"`)

| Field | Type | Required |
|-------|------|----------|
| `type` | `"package"` | Yes |
| `name` | `string` | Yes — package name agents will import |
| `installCommand` | `string` | No — e.g. `npm install @example/sdk` |
| `language` | `string` | No — preferred solution language |
| `additionalContext` | `string` | No |

## agents

| Field | Type | Required | Runs in sandbox? |
|-------|------|----------|-----------------|
| `generator` | `AgentConfig` | No | No — runs on host |
| `executor` | `SandboxAgentConfig` | No | **Yes** — requires `secret` |
| `judge` | `SandboxAgentConfig` | No | **Yes** — requires `secret` |
| `insights` | `AgentConfig` | No | No — runs on host |

### AgentConfig (generator, insights)

| Field | Type | Required |
|-------|------|----------|
| `command` | `string` | Yes — `"claude"`, `"codex"`, `"gemini"`, or custom |
| `args` | `string[]` | No — base args, supports `{prompt}` and `{workDir}` placeholders |
| `interactiveArgs` | `string[]` | No — override args for interactive mode |
| `pipedArgs` | `string[]` | No — override args for piped mode |
| `sandboxArgs` | `string[]` | No — override args for sandbox mode |
| `installCommand` | `string` | No — override agent install command in sandbox |
| `envelope` | `string` | No — JSON field to extract from stdout (`"none"` = raw) |
| `systemPrompt` | `string` | No — supports `{{packageName}}` and `{{docsUrl}}` |
| `logPattern` | `string` | No — glob for finding session logs |

### SandboxAgentConfig (executor, judge)

Extends AgentConfig with one **required** field:

| Field | Type | Required |
|-------|------|----------|
| `secret` | `AgentSecretConfig` | **Yes** |

### AgentSecretConfig

| Field | Type | Required |
|-------|------|----------|
| `value` | `string` | **Yes** — raw key or `"$ENV_VAR"` reference |
| `envVar` | `string` | Auto-detected for known agents; **required** for custom |
| `baseUrl` | `string` | Auto-detected for known agents; **required** for custom |
| `baseUrlEnvVar` | `string` | Auto-detected for known agents; optional for custom |

### Known Agent Defaults (auto-filled when field is absent)

| `command` | `envVar` | `baseUrl` | `baseUrlEnvVar` |
|-----------|----------|-----------|-----------------|
| `claude` | `ANTHROPIC_API_KEY` | `https://api.anthropic.com` | `ANTHROPIC_BASE_URL` |
| `codex` | `OPENAI_API_KEY` | `https://api.openai.com` | `OPENAI_BASE_URL` |
| `gemini` | `GOOGLE_API_KEY` | `https://generativelanguage.googleapis.com` | `GEMINI_API_BASE_URL` |

Custom agents (any command not in the table above) **must** provide `envVar` and `baseUrl` explicitly.

## TargetConfig

| Field | Type | Required |
|-------|------|----------|
| `name` | `string` | Yes — label used in result paths |
| `image` | `string` | Yes — Docker image for sandbox |
| `timeout` | `number` | No — max seconds per execution |
| `additionalContext` | `string` | No — included in generator prompt for setupInstructions |

## SandboxConfig

| Field | Type | Required |
|-------|------|----------|
| `concurrency` | `number` | No — max concurrent sandbox instances |
| `defaultTimeout` | `number` | No — default timeout |
| `memoryMib` | `number` | No — memory limit per sandbox |
| `cpus` | `number` | No — CPU limit per sandbox |
| `secrets` | `Record<string, SecretConfig>` | No — TLS-injected secrets (never enter the VM) |
| `env` | `Record<string, string>` | No — plain env vars passed into sandbox |

### SecretConfig (within `sandbox.secrets`)

| Field | Type | Required |
|-------|------|----------|
| `value` | `string` | Yes — raw value or `"$ENV_VAR"` |
| `allowHosts` | `string[]` | Yes — non-empty, domains where secret is sent |
| `allowHostPatterns` | `string[]` | No — glob patterns for allowed hosts |

## WorkspaceConfig

| Field | Type | Required |
|-------|------|----------|
| `template` | `string` | No — local directory to copy into sandbox workspace |
| `setupScript` | `string` | No — path to script run during workspace setup |

## Validation Rules

1. Root must be a JSON object
2. `privateInfo` must be a non-empty array with valid source entries
3. `publicInfo`, if present, must be an array with valid source entries
4. `targets` must be a non-empty array
5. `sandbox` must be present and be an object
6. `sandbox.secrets` entries must have non-empty `value` and non-empty `allowHosts`
7. `agents.executor` and `agents.judge` must have `secret.value` (non-empty string)
8. Custom agents must provide `envVar` and `baseUrl` in their secret
9. `baseUrl` must be a parseable URL

## Minimal Examples

### Known agent (claude):
```json
{
  "privateInfo": [{ "type": "local", "path": "./src" }],
  "agents": {
    "executor": { "command": "claude", "secret": { "value": "$ANTHROPIC_API_KEY" } },
    "judge": { "command": "claude", "secret": { "value": "$ANTHROPIC_API_KEY" } }
  },
  "targets": [{ "name": "node-20", "image": "node:20-slim" }],
  "sandbox": {}
}
```

### Custom agent:
```json
{
  "agents": {
    "executor": {
      "command": "my-agent",
      "secret": {
        "value": "$MY_API_KEY",
        "envVar": "MY_API_KEY",
        "baseUrl": "https://api.my-service.com"
      }
    }
  }
}
```
