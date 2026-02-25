# TUI API (Experimental)

Forkline TUI is a terminal client over core HTTP + SSE APIs.

Implementation source:
- `packages/tui/src/index.js`
- `packages/tui/bin/forkline-tui.js`

## Layer 1: Quickstart

1. Start core:

```bash
npm run core:start
```

2. Start TUI:

```bash
npm run tui:start:experimental
```

3. In prompt, run:

```text
health
sessions
spawn task-1 /absolute/path/to/repo
follow task-1
```

## Layer 2: Practical recipes

### Basic task loop

1. `spawn <taskId> [cwd]`
2. `follow <taskId>`
3. `input <text>` or `send <taskId> <text>`
4. `status <taskId>` / `plan <taskId>` / `testfix <taskId>`
5. `destroy <taskId>`

### Blocked prompt handling

- `resume [taskId]` sends a protocol quick-action for confirmation continuation.
- `pause [taskId]` sends `Ctrl+C`.

### Session state checks

- `sessions` maps current `mode` and blocked state per task.
- mode/blocking updates come from `/v1/events` subscription.

## Layer 3: Command contract

## Interactive commands

| Command | Description |
|---|---|
| `health` | Calls `GET /v1/health` |
| `version` | Calls `GET /v1/version` |
| `sessions` | Calls `GET /v1/pty/sessions` |
| `spawn <taskId> [cwd]` | Calls `POST /v1/pty/create` |
| `follow <taskId>` | Sets active output-follow target |
| `send <taskId> <text>` | Calls `POST /v1/pty/write` |
| `input <text>` | Writes to followed task |
| `resume [taskId]` | Executes quick action `resume` |
| `pause [taskId]` | Executes quick action `pause` |
| `status [taskId]` | Executes quick action `status` |
| `plan [taskId]` | Executes quick action `plan` |
| `testfix [taskId]` | Executes quick action `test_and_fix` |
| `context [taskId]` | Executes quick action `context` |
| `cost [taskId]` | Executes quick action `cost` |
| `resize <taskId> <cols> <rows>` | Calls `POST /v1/pty/resize` |
| `destroy <taskId>` | Calls `POST /v1/pty/destroy` |
| `clear` | Clears terminal + reprints help |
| `q` | Exit |

## Transport and auth

- HTTP JSON requests use core token auth headers.
- SSE stream subscribes to `GET /v1/events`.
- TUI exits early if no token is available.

## Environment variables

- `FORKLINE_CORE_URL`
- `FORKLINE_TUI_AGENT`
- `FORKLINE_CORE_TOKEN`
- `FORKLINE_CORE_TOKEN_FILE`

See [Environment Variables](/reference/environment-variables).
