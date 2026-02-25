# Agent Control API

This API is exposed by the Electron `AgentControlServer` for agent-to-UI communication.

Base URL: `http://127.0.0.1:<dynamic-port>`

Implementation source:
- `electron/agentServer.ts`

## Layer 1: Quickstart

```bash
BASE_URL="http://127.0.0.1:34567"
TOKEN="<MULTI_AGENT_IDE_TOKEN>"
TASK_ID="task-1"

# Push todos into the renderer
curl -s -H "x-forkline-token: $TOKEN" -H "content-type: application/json" \
  -X POST "$BASE_URL/api/task/$TASK_ID/todos" \
  -d '{"todos":[{"id":"1","title":"Implement fix","status":"in_progress"}]}'
```

## Layer 2: Recipes

### Merge approval lifecycle (polling mode)

1. Request merge:

```bash
curl -s -H "x-forkline-token: $TOKEN" -H "content-type: application/json" \
  -X POST "$BASE_URL/api/task/$TASK_ID/merge" \
  -d '{}'
```

Response is `202` with `requestId` and `pollUrl`.

2. Poll decision:

```bash
curl -s -H "x-forkline-token: $TOKEN" "$BASE_URL/api/approval/<requestId>"
```

3. Renderer/user responds through IPC (`agent:respond`), then poll returns `approved` or `rejected`.

### Merge inline wait mode

```bash
curl -s -H "x-forkline-token: $TOKEN" -H "content-type: application/json" \
  -X POST "$BASE_URL/api/task/$TASK_ID/merge?wait=1" \
  -d '{}'
```

If no decision is sent in 10 minutes, route returns `408`.

### Usage action aliases

Both routes emit `agent:usage` to renderer:
- `POST /api/task/:taskId/usage`
- `POST /api/task/:taskId/metrics`

## Layer 3: Full Contracts

## Routes

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/task/:taskId/merge` | Yes | Queue merge approval request (`202`) |
| `POST` | `/api/task/:taskId/todos` | Yes | Forward todos payload to renderer |
| `POST` | `/api/task/:taskId/message` | Yes | Forward message payload to renderer |
| `POST` | `/api/task/:taskId/usage` | Yes | Forward usage payload to renderer |
| `POST` | `/api/task/:taskId/metrics` | Yes | Alias of `usage` |
| `GET` | `/api/approval/:requestId` | Yes | Read approval status |

## Auth and security controls

- Loopback-only remote addresses accepted.
- Any request with `Origin` header is rejected.
- Token auth is mandatory:
  - `Authorization: Bearer <token>`
  - `x-forkline-token: <token>`
- Action allowlist: `merge`, `todos`, `message`, `usage`, `metrics`.
- Request body cap: `1_000_000` bytes.

## Response envelopes

Synchronous actions (`todos`, `message`, `usage`, `metrics`):

```json
{ "success": true }
```

Merge queued (`202`):

```json
{
  "success": true,
  "status": "pending",
  "requestId": "1700000000000-abc123",
  "pollUrl": "http://127.0.0.1:34567/api/approval/1700000000000-abc123"
}
```

Approval lookup (`200`):

```json
{
  "success": true,
  "requestId": "1700000000000-abc123",
  "taskId": "task-1",
  "action": "merge",
  "status": "pending",
  "createdAt": 1700000000000,
  "updatedAt": 1700000000000,
  "decision": null
}
```

Error envelope:

```json
{ "error": "..." }
```

## Approval persistence model

- Pending and recent resolved approvals are persisted to disk.
- Pending approvals survive Electron restarts.
- Resolved approvals are retained up to 7 days and bounded by count.

## Renderer IPC channels emitted

- `agent:request` (approval-gated merge)
- `agent:todos`
- `agent:message`
- `agent:usage`
