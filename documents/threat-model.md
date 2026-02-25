# Forkline Threat Model

## Scope

This document covers the local attack surface of:
- Core daemon (`packages/core`)
- Electron control server (`electron/agentServer.ts`)
- PTY orchestration and session persistence
- Renderer ↔ main IPC boundary

It does not cover cloud-hosted infrastructure because Forkline is local-first.

## Assets

- local source code in active worktrees
- agent prompts/instructions and terminal output
- local secrets passed via env vars
- task metadata and fleet history
- local control-plane auth tokens

## Trust Boundaries

1. Browser/renderer UI
2. Electron main process
3. Local HTTP servers (core + control server)
4. PTY child processes
5. Filesystem persistence (`workspace.json`, runtime sessions, fleet db)

## Adversary Model

### A1: Malicious website in local browser
Goal: issue localhost requests to control endpoints.

Mitigations:
- loopback checks
- browser-origin rejection
- token authentication required on sensitive endpoints

### A2: Local unprivileged process on same machine
Goal: issue requests to localhost services or scrape process output.

Mitigations:
- token authentication
- no query-string token distribution
- token stored in local file with restricted permissions (`~/.forkline/core.token`)
- rate limits and session caps to reduce abuse blast radius

Residual risk:
- local malware running as same user can often read user files/process memory.

### A3: Compromised renderer/XSS
Goal: abuse preload-exposed APIs to control PTY/git paths.

Mitigations:
- context isolation + sandbox + web security
- CSP
- navigation/window-open restrictions
- input validation on PTY IPC and daemon endpoints

Residual risk:
- renderer compromise is still high impact due orchestrator nature.

## Key Controls

- Authentication:
  - Core and control APIs require token auth on non-public endpoints.
- Network policy:
  - services bind to `127.0.0.1`
  - cross-origin browser traffic denied
- Abuse controls:
  - request rate limiting
  - SSE client cap
  - PTY session cap
  - payload size limits
- Input validation:
  - task id regex constraints
  - absolute-path validation for filesystem/git targets
  - write-size limits for PTY input
- Secret hygiene:
  - no URL query token propagation
  - non-persistence of workspace env vars

## Non-Goals

- Preventing compromise by a fully privileged local admin/root attacker.
- Remote multi-tenant isolation guarantees (Forkline is single-user local runtime).

## Security Review Checklist

Before release:
- `npm run security:audit`
- `npm run typecheck`
- `npm run build`
- `npx playwright test e2e/electron.smoke.spec.js`
- Validate token auth and origin rejection manually (README security verification section)
