# Environment Variables

This page documents runtime variables that are currently implemented in core, GUI, and TUI paths.

## Layer 1: Quickstart presets

### Core hardened local mode

```bash
export FORKLINE_CORE_PORT=34600
export FORKLINE_CORE_RATE_LIMIT_PER_MINUTE=1200
export FORKLINE_CORE_MAX_SSE_CLIENTS=64
npm run core:start
```

### Core with dependency hydration

```bash
export FORKLINE_DEPENDENCY_AUTOINSTALL=1
export FORKLINE_DEPENDENCY_HYDRATION_MODE=background
export FORKLINE_PACKAGE_STORE_STRATEGY=polyglot_global
npm run core:start
```

## Layer 2: Practical recipes

- Use `FORKLINE_CORE_TOKEN` for explicit token injection in CI/dev containers.
- Use `FORKLINE_CORE_TOKEN_FILE` when sharing token with local tooling.
- Use `FORKLINE_SANDBOX_MODE=auto` and `FORKLINE_NETWORK_GUARD=block` for stricter task execution.
- Use `FORKLINE_PTY_PERSISTENCE_MODE=off` if tmux persistence is not desired.

## Layer 3: Full variable reference

## Core daemon (`packages/core`)

| Variable | Default | Notes |
|---|---|---|
| `FORKLINE_CORE_PORT` | `34600` | HTTP listen port |
| `FORKLINE_CORE_TOKEN` | generated | Auth token override |
| `FORKLINE_CORE_TOKEN_FILE` | `~/.forkline/core.token` | Token file path |
| `FORKLINE_CORE_MAX_BODY_BYTES` | `2000000` | Max HTTP request body |
| `FORKLINE_CORE_MAX_PTY_WRITE_BYTES` | `64000` | Max `/v1/pty/write` payload |
| `FORKLINE_CORE_MAX_SSE_CLIENTS` | `64` | Max active SSE clients |
| `FORKLINE_CORE_RATE_LIMIT_PER_MINUTE` | `1200` | Per-address request limit |
| `FORKLINE_CORE_MAX_PTY_SESSIONS` | `256` | PTY session cap |

## PTY/runtime behavior (`packages/core/src/services/pty-service.js`)

| Variable | Default | Notes |
|---|---|---|
| `FORKLINE_PTY_PERSISTENCE_MODE` | `auto` | `auto`, `tmux`, `off` |
| `FORKLINE_SANDBOX_MODE` | `off` | `off`, `auto`, `seatbelt`, `firejail` |
| `FORKLINE_NETWORK_GUARD` | `off` | `block`/`disabled`/`none` disables network in sandbox |
| `FORKLINE_PACKAGE_STORE_STRATEGY` | `off` | `off`, `pnpm_global`, `polyglot_global` |
| `FORKLINE_PNPM_STORE_PATH` | unset | Override PNPM store path |
| `FORKLINE_SHARED_CACHE_ROOT` | `~/.forkline-cache` | Shared cache root when strategy enabled |

## Worktree dependency hydration (`packages/core/src/services/git-service.js`)

| Variable | Default | Notes |
|---|---|---|
| `FORKLINE_DEPENDENCY_AUTOINSTALL` | off | Enable dependency bootstrap in new worktrees |
| `FORKLINE_PNPM_AUTOINSTALL` | off | Compatibility alias for auto-install |
| `FORKLINE_DEPENDENCY_HYDRATION_MODE` | `background` | `background` or `blocking` |

## GUI runtime (`electron`)

| Variable | Default | Notes |
|---|---|---|
| `FORKLINE_KEEP_BACKGROUND_SERVICES` | `1` | Keep orchestration services alive after window close |

## TUI runtime (`packages/tui`)

| Variable | Default | Notes |
|---|---|---|
| `FORKLINE_CORE_URL` | `http://127.0.0.1:34600` | Core endpoint |
| `FORKLINE_TUI_AGENT` | `shell` | Agent command hint for quick actions |
| `FORKLINE_CORE_TOKEN` | none | Auth token override |
| `FORKLINE_CORE_TOKEN_FILE` | `~/.forkline/core.token` | Token file path |

## Token resolution order

Core and TUI resolve token in this order:
1. `FORKLINE_CORE_TOKEN`
2. `FORKLINE_CORE_TOKEN_FILE`
3. `~/.forkline/core.token`

Core generates and persists a new token when none exists.
