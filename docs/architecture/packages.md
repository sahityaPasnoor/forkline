# Package Boundaries

## `packages/core`

Owns runtime orchestration:

- daemon HTTP/SSE server (`src/daemon.js`)
- PTY session management (`src/services/pty-service.js`)
- Git worktree lifecycle (`src/services/git-service.js`)

## `packages/protocol`

Shared contract layer:

- route constants (`src/index.js`)
- quick-action planning logic (`src/quick-actions.js`)

## `packages/tui`

Experimental terminal client:

- API client and command dispatcher (`src/index.js`)
- event stream follow mode
- quick-action command wrappers

## `electron`

GUI control plane runtime:

- Electron app lifecycle (`main.ts`)
- local agent control server (`agentServer.ts`)
- PTY and Git manager integration
- persistent fleet store

## `src`

React renderer:

- task terminal views and dashboards
- approvals and diff/merge UX
- settings and onboarding flows

## Dependency direction

- `gui` and `tui` depend on `core` API contracts.
- `protocol` is shared and should remain UI-agnostic.
- PTY and Git orchestration logic should live in `core`, not in UI clients.
