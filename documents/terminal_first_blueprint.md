# Forkline Terminal-First Blueprint

> Status note (current): this is a long-term architecture blueprint. In the current product, `core` + `gui` are primary and `tui` is experimental.

## Goal
Make Forkline a terminal-first product where:
- `core` is open source (headless engine + API + CLI).
- `tui` is a first-party terminal UI client on top of `core`.
- any private UI (Electron/web) is optional and separate.

---

## Monorepo Layout

```text
forkline/
  packages/
    core/
      src/
        daemon/
        pty/
        git/
        fleet/
        policy/
        api/
        events/
      bin/
        forkline-core
      package.json
    cli/
      src/
        commands/
      bin/
        forkline
      package.json
    tui/
      src/
        app/
        views/
        widgets/
        keymap/
      package.json
    protocol/
      src/
        types.ts
        zod.ts
      package.json
  docs/
  LICENSE
```

Notes:
- `protocol` holds shared request/response/event types.
- `core` has no UI dependency.
- `tui` only talks to `core` over API/events.

---

## Runtime Model

1. `forkline-core` runs as a local daemon.
2. `forkline` CLI starts/stops/status-checks daemon and can issue direct commands.
3. `forkline-tui` attaches to daemon and renders panels.

Transport defaults:
- Unix socket: `~/.forkline/run/core.sock` (preferred on macOS/Linux).
- TCP fallback: `127.0.0.1:34600`.

Persistence:
- `~/.forkline/fleet.sqlite`
- `~/.forkline/runtime-session.json`

---

## Core Services (Open Source Boundary)

1. Session Service
- Spawn PTY sessions by `taskId`.
- Attach/detach subscribers.
- Write input, resize, destroy.
- Keep ring buffer for reconnect/restore.

2. Worktree Service
- Validate workspace/repo.
- Create/list/remove/merge worktrees.
- Enforce safe task/worktree naming.

3. Task/Fleet Service
- Track tasks, statuses, collisions, usage, todos, timeline.
- Record events for every state mutation.

4. Policy/Approval Service
- Queue restricted actions.
- Project-level policy (autonomous mode, auto-merge, prompt response).
- Resolve pending approvals.

5. Event Bus
- Broadcast typed events (`pty.data`, `task.updated`, `approval.required`, etc.).

---

## API Contract (v1)

### 1) Health + Daemon
- `GET /v1/health`
- `GET /v1/version`

### 2) Projects
- `GET /v1/projects`
- `POST /v1/projects/open`
  - body: `{ "path": "/abs/path" }`
  - response: `{ "projectId": "..." }`

### 3) Tasks
- `POST /v1/tasks`
  - body:
  ```json
  {
    "projectId": "proj_123",
    "name": "auth-refactor",
    "agent": "claude",
    "prompt": "refactor auth flow",
    "parentTaskId": null
  }
  ```
- `GET /v1/tasks?projectId=...&scope=active|closed|archived|all&search=...`
- `GET /v1/tasks/:taskId`
- `POST /v1/tasks/:taskId/close`
  - body: `{ "action": "merge" | "delete" }`
- `POST /v1/tasks/:taskId/archive`
  - body: `{ "archived": true }`

### 4) PTY Sessions
- `POST /v1/tasks/:taskId/session/start`
  - body: `{ "cwd": "/abs/worktree/path", "env": { "K": "V" } }`
- `POST /v1/tasks/:taskId/session/input`
  - body: `{ "data": "..." }`
- `POST /v1/tasks/:taskId/session/resize`
  - body: `{ "cols": 120, "rows": 40 }`
- `POST /v1/tasks/:taskId/session/detach`
- `POST /v1/tasks/:taskId/session/destroy`
- `GET /v1/tasks/:taskId/session`

### 5) Quick Actions (core-level macros, optional)
- `POST /v1/tasks/:taskId/actions/plan`
- `POST /v1/tasks/:taskId/actions/test-fix`
- `POST /v1/tasks/:taskId/actions/commit-push`
- `POST /v1/tasks/:taskId/actions/handover`
  - body: `{ "agent": "aider", "prompt": "continue..." }`
- `POST /v1/tasks/:taskId/actions/split`
  - body: `{ "count": 3, "agent": "claude", "objective": "..." }`

### 6) Approvals
- `GET /v1/approvals`
- `POST /v1/approvals/:requestId/approve`
- `POST /v1/approvals/:requestId/reject`

### 7) Policies
- `GET /v1/projects/:projectId/policy`
- `PUT /v1/projects/:projectId/policy`
  - body:
  ```json
  {
    "autonomousMode": false,
    "autoApproveMerge": false,
    "autoRespondPrompts": false,
    "promptResponse": "y"
  }
  ```

### 8) Timeline + Inventory
- `GET /v1/tasks/:taskId/timeline`
- `GET /v1/projects/:projectId/worktrees`
- `GET /v1/projects/:projectId/collisions`

### 9) Event Stream
- `GET /v1/events` (SSE) or `WS /v1/ws`
- envelope:
```json
{
  "id": "evt_...",
  "ts": 1730000000000,
  "type": "task.updated",
  "projectId": "proj_123",
  "taskId": "task_456",
  "payload": {}
}
```

---

## TUI Product Spec

Primary layout:
- Left pane: agent/task manager (create, delete, status, filters).
- Main pane: active terminal.
- Bottom dock: quick actions (`status`, `plan`, `test&fix`, `handover`, `merge`, `delete`, `commit&push`, `split`).
- Global indicator bar: approvals + blocked tasks by project.

Views:
- `Ctrl+1`: Terminal
- `Ctrl+2`: Fleet dashboard
- `Ctrl+3`: Worktree inventory
- `Ctrl+4`: Approval queue
- `Ctrl+5`: Project switcher

Non-negotiables:
- Reattach to PTY without losing output buffer.
- Deterministic key handling (no dropped Enter/backspace).
- Session restore on TUI restart.

---

## Security/OSS Boundary

Open source (`core`, `cli`, `tui` optional):
- PTY/worktree logic
- API/protocol
- persistence schema

Private (if desired):
- premium/private UI(s)
- hosted sync/telemetry services
- enterprise policy extensions

Recommended core license:
- MIT or Apache-2.0.

---

## Migration Plan (from current app)

Phase 1: Extract core modules
- move `electron/ptyManager.ts` -> `packages/core/src/pty/`
- move `electron/gitManager.ts` -> `packages/core/src/git/`
- move `electron/fleetStore.ts` -> `packages/core/src/fleet/`
- move approval/control server logic -> `packages/core/src/api/`

Phase 2: Define protocol package
- strict shared schemas for requests/responses/events.

Phase 3: Build `forkline-core` daemon
- CLI start/stop/status.
- API endpoints + event stream.

Phase 4: Build `forkline-tui`
- replace Electron renderer interactions with API calls.
- render live PTY stream + dashboards.

Phase 5: Keep private UI as second client
- private UI consumes same protocol.
- no direct process/git access from UI.

---

## Immediate Next Step

Start with a thin daemon wrapper around your current PTY + git + fleet modules, expose only:
- create/list tasks
- start/write/resize PTY
- list approvals + approve/reject
- event stream

Then point a minimal TUI shell at that API before adding advanced views.

---

## Bootstrap Commands (Current Repo)

From repo root:

```bash
# 1) Start core daemon
npm run core:start

# 2) In another terminal, start terminal UI bootstrap
npm run tui:start

# 3) Start GUI (current Electron app)
npm run gui:start
```
