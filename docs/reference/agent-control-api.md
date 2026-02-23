# Agent Control API

This API is exposed by the Electron `AgentControlServer` for agent-to-UI communication.

Base URL: `http://127.0.0.1:<dynamic-port>`

Route template:

- `POST /api/task/:taskId/:action`

Allowed actions:

- `merge`
- `todos`
- `message`
- `usage`
- `metrics` (normalized to `usage`)

## Auth and network controls

- loopback-only requests
- browser-origin requests denied
- token auth via `Authorization: Bearer` or `x-forkline-token`
- strict action allowlist
- request size cap: `1_000_000` bytes

## Action behavior

### Synchronous actions

- `todos`
- `message`
- `usage` / `metrics`

These emit IPC events to renderer and return immediate `200`.

### Approval-gated action

- `merge`

This creates an approval request and waits for UI decision.

- timeout: 60 seconds
- timeout result: `408`

## Example: update todos

```bash
curl -s \
  -H "x-forkline-token: $MULTI_AGENT_IDE_TOKEN" \
  -H "content-type: application/json" \
  -X POST "http://127.0.0.1:34567/api/task/task-1/todos" \
  -d '{"todos":[{"id":"1","title":"Implement fix","status":"in_progress"}]}'
```

## Response examples

Success:

```json
{ "success": true }
```

Unauthorized:

```json
{ "error": "Unauthorized control request." }
```

Unsupported action:

```json
{ "error": "Unsupported action: <action>" }
```

## Implementation source

- `electron/agentServer.ts`
