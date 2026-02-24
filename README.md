# Forkline

Forkline is a local-first orchestration platform for running many local coding agents in parallel across isolated Git worktrees.

Runtime support tier:
- `core` (stable): headless daemon for PTY + Git orchestration
- `gui` (stable): Electron + React command center
- `tui` (experimental): terminal client on top of core

## What Problem Forkline Solves

When teams run multiple headless agents on one repo, they usually hit the same failures:
- terminal sprawl (too many shells, no state model)
- branch collisions (agents editing same files)
- blocked prompts hidden in background tabs
- context loss across reloads/restarts
- no auditable view of what happened across sessions

Forkline solves this by making `worktree isolation + PTY state + operator control` first-class.

## Why This Is Not Reinventing the Wheel

Forkline is not a replacement for your model CLI (Claude, Aider, Codex, Gemini, etc). It is the orchestration layer above them.

| Existing Tool | Great At | Missing For Multi-Agent Ops | Forkline Adds |
|---|---|---|---|
| Raw terminal / tmux | shell power | no structured task model, no cross-session fleet state | persistent task/session graph + worktree/task lifecycle |
| Plain `git worktree` | branch isolation | manual plumbing, no operator UX | automated spawn/merge/delete + inventory + restore |
| Single-agent IDE plugin | focused coding loop | weak parallel fleet control across many agents | fleet-level observability and blocked-action handling |
| Agent CLIs themselves | code generation/editing | no global orchestrator policy and no multi-agent control plane | shared control plane, approvals, collision/status wiring |

Forkline's unique wedge: **local-first, model-agnostic, worktree-native multi-agent orchestration with persistent PTY/session semantics**.

## Core Capabilities

- Automatic worktree spawn per task with branch safety checks
- Per-task terminal sessions with PTY restore after UI refresh/restart
- Blocked prompt detection and operator approval flow
- Fleet persistence (projects/tasks/events/sessions)
- Quick actions (`status`, `resume`, `pause`, `test & fix`, `plan`, `handover`, `merge`, `delete`)
- Per-workspace context + MCP config injection
- Parent-branch selection when spawning tasks

## Current MCP Behavior

MCP is centralized in workspace settings and surfaced in spawn/runtime UX.

- Native launch wiring: `Claude`
- Explicitly unsupported (currently warned in UI/runtime): `Aider`, `Gemini`, `Codex`, `Amp`, `Cursor`, `Cline`, `Sweep`, generic shell

If MCP is enabled globally but not supported by the selected agent, Forkline informs the user and launches without MCP flags.

## Security Model (Implemented)

### GUI Control Server (`127.0.0.1:34567+`)
- loopback-only requests
- token auth required (`x-forkline-token` or `Authorization: Bearer ...`)
- cross-origin browser requests denied
- action allowlist (`merge`, `todos`, `message`, `usage`/`metrics`)
- payload size caps and request timeouts

### Core Daemon (`127.0.0.1:34600`)
- loopback-only requests
- token auth required for non-public endpoints
- browser-origin requests denied (no permissive CORS)
- request rate limiting
- SSE client cap
- PTY session cap
- PTY write-size limits
- endpoint-level input validation for task ids and filesystem paths

### Renderer/Electron Hardening
- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true`
- navigation/window-open restrictions
- CSP in renderer HTML

### Secret Handling
- workspace `env vars` are intentionally not persisted to disk
- core auth token is loaded from `FORKLINE_CORE_TOKEN` or `~/.forkline/core.token`
- query-string tokens were removed from control URLs

## Architecture

```text
Agent CLI (claude/aider/etc)
    |
    | (local HTTP, token-auth)
    v
Electron AgentControlServer (GUI mode)
    |
    +--> Renderer (React + xterm)
    |
    +--> PTY manager (node-pty)
    +--> Git manager (simple-git + worktrees)
    +--> Fleet store (sql.js)

Core/TUI mode:
TUI <-> Core Daemon (HTTP + SSE, token-auth) <-> PTY/Git services
```

## Install

Requirements:
- Node.js `20+`
- npm `10+`
- Git in `PATH`

```bash
npm ci
```

## Run

### GUI development

```bash
npm run dev
```

### Core daemon (headless)

```bash
npm run core:start
```

On first run, core creates `~/.forkline/core.token` (0600). You can override with:
- `FORKLINE_CORE_TOKEN`
- `FORKLINE_CORE_TOKEN_FILE`

### TUI client

```bash
npm run tui:start:experimental
```

TUI reads auth token from:
1. `FORKLINE_CORE_TOKEN`
2. `FORKLINE_CORE_TOKEN_FILE`
3. `~/.forkline/core.token`

Optional:
- `FORKLINE_CORE_URL` (default `http://127.0.0.1:34600`)
- `FORKLINE_TUI_AGENT` (default `shell`)

TUI is currently experimental. Expect API/UX changes.

### GUI command

```bash
npm run gui:start
```

## Build and Package

```bash
npm run typecheck
npm run build
npm run dist:local
```

## Quality Gates

```bash
npm run security:audit
npm run security:audit:prod
npm run security:smoke
npm run preflight:release
npx playwright test e2e/electron.smoke.spec.js
```

GitHub Actions enforcement:
- `CI` workflow: install, `security:audit`, `security:smoke`, typecheck, build
- `Security` workflow: Dependency Review (PR), Semgrep (`auto` + `.semgrep/rules`), CodeQL (push/PR + weekly schedule)
- `Release` workflow: pinned-action supply chain, SBOM generation (CycloneDX + SPDX), npm provenance + artifact attestation

## Manual Security Verification

Start core and verify controls:

```bash
# should be 200 (public)
curl -i http://127.0.0.1:34600/v1/health

# should be 403 without token
curl -i http://127.0.0.1:34600/v1/pty/sessions

# should be 200 with token
TOKEN=$(cat ~/.forkline/core.token)
curl -i -H "Authorization: Bearer $TOKEN" http://127.0.0.1:34600/v1/pty/sessions

# should be 403 for browser-origin requests
curl -i -H "Origin: https://evil.example" -H "Authorization: Bearer $TOKEN" http://127.0.0.1:34600/v1/pty/sessions
```

## Repository Structure

- `packages/core/` headless daemon + PTY/Git services
- `packages/tui/` experimental terminal client
- `packages/protocol/` shared contract (routes/events/quick-actions)
- `electron/` Electron main/preload/server/store
- `src/` React renderer
- `e2e/` Playwright Electron smoke tests
- `documents/` architecture, release, and security docs

## Open Source Standards

- `LICENSE` (MIT)
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `SECURITY.md`
- `SUPPORT.md`
- `GOVERNANCE.md`
- CI release workflow and release preflight checks

## Documentation Index

- Security policy: `SECURITY.md`
- Threat model: `documents/threat-model.md`
- Release playbook: `documents/release-playbook.md`

## GitHub Pages Docs

Forkline ships a full docs site for operators and contributors:

- Local dev: `npm run docs:dev`
- Build: `npm run docs:build`
- Preview: `npm run docs:preview`

Primary sections:

- Guide (`docs/guide/`)
- Architecture (`docs/architecture/`)
- API Reference (`docs/reference/`)
- Operations (`docs/operations/`)
- Community (`docs/community/`)

## License

MIT
