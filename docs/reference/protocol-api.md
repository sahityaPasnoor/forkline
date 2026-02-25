# Protocol API

Shared protocol contract used across core, GUI, and TUI.

Implementation source:
- `packages/protocol/src/index.js`
- `packages/protocol/src/quick-actions.js`
- `packages/protocol/src/pty-state-machine.js`

## Layer 1: Quickstart

```js
const {
  Routes,
  Events,
  PTY_MODES,
  resolveQuickActionPlan,
  PtySessionStateMachine
} = require('@forkline/protocol');
```

Use `Routes` for route constants, `Events` for shared event identifiers, and `PtySessionStateMachine` for mode/blocking inference.

## Layer 2: Practical recipes

### Route-safe core client

- Use `Routes.GIT_WORKTREE_CREATE` instead of hardcoded paths.
- Keep new routes in `Routes` synchronized with daemon implementation.

### Deterministic quick-action planning

- Build plans with `resolveQuickActionPlan({ action, agentCommand, isBlocked })`.
- Execute generated `steps` without custom branching in clients.

### PTY mode tracking

- Instantiate `new PtySessionStateMachine(...)` per PTY session.
- Feed output via `consumeOutput(...)` and input via `consumeInput(...)`.
- Persist only derived snapshots, not raw heuristics.

## Layer 3: Full export contract

## `Events`

```js
{
  TASK_UPDATED: 'task.updated',
  PTY_DATA: 'pty.data',
  PTY_MODE: 'pty.mode',
  APPROVAL_REQUIRED: 'approval.required',
  APPROVAL_RESOLVED: 'approval.resolved'
}
```

## `Routes`

```js
{
  HEALTH: '/v1/health',
  VERSION: '/v1/version',
  EVENTS: '/v1/events',
  GIT_VALIDATE: '/v1/git/validate',
  GIT_WORKTREE_CREATE: '/v1/git/worktree/create',
  GIT_WORKTREE_LIST: '/v1/git/worktree/list',
  GIT_BRANCH_LIST: '/v1/git/branches/list',
  GIT_WORKTREE_REMOVE: '/v1/git/worktree/remove',
  GIT_WORKTREE_MERGE: '/v1/git/worktree/merge',
  GIT_DIFF: '/v1/git/diff',
  GIT_MODIFIED_FILES: '/v1/git/modified-files',
  PTY_CREATE: '/v1/pty/create',
  PTY_ATTACH: '/v1/pty/attach',
  PTY_DETACH: '/v1/pty/detach',
  PTY_WRITE: '/v1/pty/write',
  PTY_RESIZE: '/v1/pty/resize',
  PTY_DESTROY: '/v1/pty/destroy',
  PTY_SESSIONS: '/v1/pty/sessions'
}
```

## PTY mode exports

- `PTY_MODES`: `booting`, `shell`, `agent`, `tui`, `blocked`, `exited`
- `PTY_MODE_CONFIDENCE`: `low`, `medium`, `high`
- `SUPPORTED_PROVIDERS`: `claude`, `gemini`, `amp`, `aider`, `codex`

## State machine methods

`PtySessionStateMachine` public methods:
- `snapshot()`
- `start()`
- `consumeOutput(data, options?)`
- `consumeInput(data)`
- `consumeExit(exitCode, signal)`
- `updateAltScreen(next)`
- `transition(patch)`
- `reconcile(source?)`

## Utility exports

- `detectAgentCapabilities(agentCommand)`
- `resolveQuickActionPlan({ action, agentCommand, isBlocked })`
- `detectProviderFromCommand(command)`
- `buildAgentWrapperCommand(command, provider)`
- `parseForklineMarkers(data)`
