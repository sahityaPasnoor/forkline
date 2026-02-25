# Forkline

Forkline is a local-first orchestration platform for running many local coding agents in parallel across isolated Git worktrees.

Runtime support tier:
- `core` (stable): headless daemon for PTY + Git orchestration
- `gui` (stable): Electron + React command center

## What Problem Forkline Solves

When teams run multiple headless agents on one repo, they usually hit the same failures:
- terminal sprawl (too many shells, no state model)
- branch collisions (agents editing same files)
- blocked prompts hidden in background tabs
- context loss across reloads/restarts
- no auditable view of what happened across sessions

Forkline solves this by making `worktree isolation + PTY state + operator control` first-class.

## Why Forkline (Not Another Agent)

Forkline is not a replacement for your coding agent.
Forkline is the orchestration layer on top of your existing agents and Git workflow.

### What stays the same

- You keep your existing agent CLI/model choice.
- You keep Git primitives (`git worktree`, branches, merges).
- You keep local execution and local repository ownership.

### What Forkline adds

- Multi-agent control plane for one repo: spawn, monitor, merge, delete, restore.
- Approval and blocked-action handling across all running tasks.
- Persistent PTY/session state with fleet-level visibility and replayable history.

### Quick comparison

| Existing approach | Strong at | Gap for parallel agent operations | Forkline adds |
|---|---|---|---|
| Agent apps/plugins | Single-agent coding loop | Weak global control across many tasks/worktrees | One operator surface for many agents in parallel |
| Raw terminal + `git worktree` | Maximum flexibility | Manual coordination and low observability | Structured lifecycle and persistent state |
| Agent frameworks/SDKs | Building custom systems | Extra engineering to operate daily coding flows | Ready local operator runtime for day-to-day usage |

Forkline's wedge: **local-first, model-agnostic, worktree-native multi-agent orchestration with persistent PTY/session semantics**.

## Core Capabilities

- Automatic worktree spawn per task with branch safety checks
- Per-task terminal sessions with PTY restore after UI refresh/restart
- Blocked prompt detection and operator approval flow
- Global approval inbox for batch approve/reject and blocked prompt responses
- Fleet persistence (projects/tasks/events/sessions)
- Prompt forensics timeline with transcript replay in Fleet dashboard
- Quick actions (`create PR`, `merge`, `delete`)
- Per-task Living Spec override with drift alerts when edits diverge from expected stack
- Parent-branch selection when spawning tasks
- Polyglot worktree hydration (`pnpm`/`npm`/`yarn`/`bun`/`uv`/`pip`/`go`/`cargo`) when auto-install is enabled

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

Core mode:
Core Daemon (HTTP + SSE, token-auth) <-> PTY/Git services
```

## Install

Requirements:
- Node.js `20+`
- npm `10+`
- Git in `PATH`

### Source install (current recommended path)

```bash
npm ci
```

### npm package status

As of February 25, 2026, `forkline` is not published on npm yet (`npm install -g forkline` returns `404`).

### Production-style local package test

```bash
npm pack
npm install -g --offline ./forkline-<version>.tgz
```

## Run

### GUI development (from source)

```bash
npm run dev
```

### GUI packaged command

```bash
forkline
```

`forkline` launches local Electron when available, and falls back to `npx electron@35.7.5` when Electron is not installed.

### Core daemon (headless, from source)

```bash
npm run core:start
```

On first run, core creates `~/.forkline/core.token` (0600). You can override with:
- `FORKLINE_CORE_TOKEN`
- `FORKLINE_CORE_TOKEN_FILE`

### Core daemon (headless, packaged command)

```bash
forkline-core
```

## Build and Package

```bash
npm run typecheck
npm run build
npm run dist:local
```

For macOS signing with your personal cert:

```bash
export FORKLINE_MAC_IDENTITY="Developer ID Application: <Your Name or Org> (<TEAMID>)"
npm run dist:local
```

`block`-matching certificate names are rejected, and auto-discovery is disabled by default.

## App Branding Configuration

Edit [`config/app-branding.json`](config/app-branding.json) to configure:
- app display name
- default tagline
- logo filename (served from `public/`)

Current logo assets:
- app: `public/logo.svg`
- docs: `docs/public/logo.svg`

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

Primary pages:

- Getting started (`docs/guide/getting-started.md`)
- How to use (`docs/guide/how-to-use.md`)
- Architecture (`docs/architecture/overview.md`)
- Core API (`docs/reference/core-api.md`)

## License

MIT
