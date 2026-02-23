# Event Model

Forkline uses server-sent events (SSE) from `GET /v1/events`.

## Envelope format

```json
{
  "id": "1700000000000-ab12cd",
  "ts": 1700000000000,
  "type": "pty.data",
  "payload": {}
}
```

## Core-emitted event types

| Type | Emitted by | Payload highlights |
|---|---|---|
| `pty.started` | PTY service | `taskId`, `cwd`, `createdAt` |
| `pty.state` | PTY service | `created`, `running`, `restarted`, `subscriberId` |
| `pty.activity` | PTY service | `taskId`, `at` |
| `pty.data` | PTY service | `taskId`, terminal output chunk |
| `pty.blocked` | PTY service | `taskId`, `isBlocked`, optional `reason` |
| `pty.exit` | PTY service | `taskId`, `exitCode`, `signal` |
| `pty.destroyed` | PTY service | `taskId` |

## Protocol constants

`packages/protocol/src/index.js` currently exports these event names for shared contracts:

- `task.updated`
- `pty.data`
- `approval.required`
- `approval.resolved`

If you add new event types, update both runtime emitters and shared protocol constants.
