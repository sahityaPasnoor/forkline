# Configuration

## Core daemon variables

| Variable | Default | Description |
|---|---|---|
| `FORKLINE_CORE_PORT` | `34600` | Core daemon listen port |
| `FORKLINE_CORE_TOKEN` | unset | Static auth token override |
| `FORKLINE_CORE_TOKEN_FILE` | `~/.forkline/core.token` | Token file path |
| `FORKLINE_CORE_MAX_BODY_BYTES` | `2000000` | Max HTTP request body bytes |
| `FORKLINE_CORE_MAX_PTY_WRITE_BYTES` | `64000` | Max bytes per PTY write |
| `FORKLINE_CORE_MAX_SSE_CLIENTS` | `64` | Maximum concurrent SSE clients |
| `FORKLINE_CORE_RATE_LIMIT_PER_MINUTE` | `1200` | Per-remote request rate limit |
| `FORKLINE_CORE_MAX_PTY_SESSIONS` | `256` | Maximum PTY sessions |

## Security-sensitive behavior

- Core and control server routes bind to loopback.
- Non-public routes require token auth.
- Browser-origin local requests are denied.
- Workspace environment variables are not persisted to disk.

## Spawn Permission Bypass (GUI)

In `Spawn Agent`, each task can enable `Bypass agent permission prompts`.

Forkline maps that toggle to provider CLI flags only when supported:

| Provider command | Flag appended by Forkline |
|---|---|
| `claude` | `--permission-mode bypassPermissions` |
| `codex` | `--dangerously-bypass-approvals-and-sandbox` |
| `gemini` | `--approval-mode yolo` |
| `amp` | `--dangerously-allow-all` |

Unsupported agent commands ignore this toggle and continue with normal approval behavior.

See [Project Dossier](/guide/project-dossier#7-security-model-implemented) for controls and residual risks.
