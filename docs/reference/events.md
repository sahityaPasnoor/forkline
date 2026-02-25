# Event Model

Forkline uses server-sent events (SSE) from `GET /v1/events` for core runtime telemetry.

Implementation source:
- `packages/core/src/daemon.js`
- `packages/core/src/services/pty-service.js`
- `packages/protocol/src/index.js`

## Layer 1: Quickstart

```bash
TOKEN=$(cat ~/.forkline/core.token)
curl -N -H "Authorization: Bearer $TOKEN" http://127.0.0.1:34600/v1/events
```

## Layer 2: Practical consumption

- Subscribe once per client and route by `type`.
- Treat `pty.mode` and `pty.blocked` as authoritative session-state signals.
- Use `pty.data` for terminal output and `pty.exit` for lifecycle completion.
- Reconcile dashboards with periodic `GET /v1/pty/sessions` snapshots.

## Layer 3: Full Contracts

## SSE envelope

```json
{
  "id": "1700000000000-ab12cd",
  "ts": 1700000000000,
  "type": "pty.data",
  "payload": {}
}
```

## Core SSE event types

| Type | Source | Payload highlights |
|---|---|---|
| `pty.started` | PTY service | `taskId`, `cwd`, `createdAt` |
| `pty.state` | PTY service | `taskId`, `created`, `running`, `restarted`, `subscriberId` |
| `pty.activity` | PTY service | `taskId`, `at` |
| `pty.data` | PTY service | `taskId`, output chunk in `data` |
| `pty.mode` | PTY state machine | `taskId`, `mode`, `modeSeq`, `isBlocked`, `blockedReason?`, `provider?` |
| `pty.blocked` | PTY state machine | `taskId`, `isBlocked`, `reason?` |
| `pty.exit` | PTY service | `taskId`, `exitCode`, `signal?` |
| `pty.destroyed` | PTY service | `taskId` |

## Protocol constants (`packages/protocol/src/index.js`)

`Events` currently exports:
- `task.updated`
- `pty.data`
- `pty.mode`
- `approval.required`
- `approval.resolved`

Note: core emits additional PTY lifecycle events that are not all represented in `Events`. Consumers that need complete runtime telemetry should subscribe by string event type at runtime.

## Related renderer IPC events (non-SSE)

Core SSE is consumed by TUI/core clients. In GUI mode, PTY updates are forwarded via IPC channels:
- `pty:data:<taskId>`
- `pty:state:<taskId>`
- `pty:mode:<taskId>`
- `pty:exit:<taskId>`
- `agent:blocked`
