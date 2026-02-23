# Environment Variables

## Core daemon

| Variable | Required | Default |
|---|---|---|
| `FORKLINE_CORE_PORT` | No | `34600` |
| `FORKLINE_CORE_TOKEN` | No | generated or file-loaded |
| `FORKLINE_CORE_TOKEN_FILE` | No | `~/.forkline/core.token` |
| `FORKLINE_CORE_MAX_BODY_BYTES` | No | `2000000` |
| `FORKLINE_CORE_MAX_PTY_WRITE_BYTES` | No | `64000` |
| `FORKLINE_CORE_MAX_SSE_CLIENTS` | No | `64` |
| `FORKLINE_CORE_RATE_LIMIT_PER_MINUTE` | No | `1200` |
| `FORKLINE_CORE_MAX_PTY_SESSIONS` | No | `256` |

## TUI client

| Variable | Required | Default |
|---|---|---|
| `FORKLINE_CORE_URL` | No | `http://127.0.0.1:34600` |
| `FORKLINE_TUI_AGENT` | No | `shell` |
| `FORKLINE_CORE_TOKEN` | Conditional | none |
| `FORKLINE_CORE_TOKEN_FILE` | Conditional | `~/.forkline/core.token` |

## Token resolution order

Core and TUI resolve auth token in this order:

1. `FORKLINE_CORE_TOKEN`
2. `FORKLINE_CORE_TOKEN_FILE`
3. default token file at `~/.forkline/core.token`

Core will generate and store a token if none exists.
