# Core API Reference

Base URL: `http://127.0.0.1:34600`

Implementation source:
- `packages/core/src/daemon.js`
- `packages/core/src/services/git-service.js`
- `packages/core/src/services/pty-service.js`

## Layer 1: Quickstart

1. Start core:

```bash
npm run core:start
```

2. Read auth token:

```bash
TOKEN=$(cat ~/.forkline/core.token)
```

3. Health and version:

```bash
curl -s http://127.0.0.1:34600/v1/health
curl -s http://127.0.0.1:34600/v1/version
```

4. Create a PTY session:

```bash
curl -s -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -X POST http://127.0.0.1:34600/v1/pty/create \
  -d '{"taskId":"task-1","cwd":"/absolute/path/to/repo"}'
```

## Layer 2: Recipes

### Worktree lifecycle

```bash
# Validate source
curl -s -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -X POST http://127.0.0.1:34600/v1/git/validate \
  -d '{"sourcePath":"/absolute/path/to/repo"}'

# Create worktree/branch
curl -s -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -X POST http://127.0.0.1:34600/v1/git/worktree/create \
  -d '{"basePath":"/absolute/path/to/repo","taskName":"task-1","baseBranch":"main","options":{"createBaseBranchIfMissing":true}}'

# List worktrees
curl -s -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -X POST http://127.0.0.1:34600/v1/git/worktree/list \
  -d '{"basePath":"/absolute/path/to/repo"}'

# Merge and cleanup
curl -s -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -X POST http://127.0.0.1:34600/v1/git/worktree/merge \
  -d '{"basePath":"/absolute/path/to/repo","taskName":"task-1","worktreePath":"/absolute/path/to/repo-worktrees/task-1"}'
```

### PTY lifecycle

```bash
# Create
curl -s -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -X POST http://127.0.0.1:34600/v1/pty/create \
  -d '{"taskId":"task-1","cwd":"/absolute/path/to/repo-worktrees/task-1","subscriberId":"cli"}'

# Attach snapshot
curl -s -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -X POST http://127.0.0.1:34600/v1/pty/attach \
  -d '{"taskId":"task-1","subscriberId":"cli"}'

# Write
curl -s -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -X POST http://127.0.0.1:34600/v1/pty/write \
  -d '{"taskId":"task-1","data":"npm test\r"}'

# Resize
curl -s -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -X POST http://127.0.0.1:34600/v1/pty/resize \
  -d '{"taskId":"task-1","cols":120,"rows":32}'

# Destroy
curl -s -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -X POST http://127.0.0.1:34600/v1/pty/destroy \
  -d '{"taskId":"task-1"}'
```

### Diff and modified files

```bash
curl -s -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -X POST http://127.0.0.1:34600/v1/git/diff \
  -d '{"worktreePath":"/absolute/path/to/repo-worktrees/task-1","syntaxAware":true}'

curl -s -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -X POST http://127.0.0.1:34600/v1/git/modified-files \
  -d '{"worktreePath":"/absolute/path/to/repo-worktrees/task-1"}'
```

## Layer 3: Full Contracts

## Authentication

Required for all non-public routes.

Accepted headers:
- `Authorization: Bearer <token>`
- `x-forkline-token: <token>`

Public routes:
- `GET /v1/health`
- `GET /v1/version`

## Security boundaries

- Loopback-only remote addresses are accepted.
- Any request with an `Origin` header is rejected.
- Per-address rate limiting is enforced.
- Request-body byte cap is enforced.
- PTY write-size cap is enforced.
- SSE client count cap is enforced.

## Envelope conventions

Most POST routes return JSON in this shape:

```json
{
  "success": true
}
```

Failure shape:

```json
{
  "success": false,
  "error": "..."
}
```

`/v1/health` and `/v1/version` return route-specific payloads.

## Endpoint matrix

| Method | Path | Auth | Request body | Success payload |
|---|---|---|---|---|
| `GET` | `/v1/health` | No | none | `{ ok, service, port, authRequired }` |
| `GET` | `/v1/version` | No | none | `{ version, api }` |
| `GET` | `/v1/events` | Yes | none | SSE stream (`text/event-stream`) |
| `GET` | `/v1/pty/sessions` | Yes | none | `{ success, sessions[] }` |
| `POST` | `/v1/git/validate` | Yes | `{ sourcePath }` | `{ valid, isRepo?, type?, error? }` |
| `POST` | `/v1/git/worktree/create` | Yes | `{ basePath, taskName, baseBranch?, options? }` | `{ success, worktreePath?, dependencyBootstrap?, error? }` |
| `POST` | `/v1/git/worktree/list` | Yes | `{ basePath }` | `{ success, worktrees[] }` |
| `POST` | `/v1/git/branches/list` | Yes | `{ basePath }` | `{ success, branches[] }` |
| `POST` | `/v1/git/worktree/remove` | Yes | `{ basePath, taskName, worktreePath, force? }` | `{ success, error? }` |
| `POST` | `/v1/git/worktree/merge` | Yes | `{ basePath, taskName, worktreePath }` | `{ success, error? }` |
| `POST` | `/v1/git/diff` | Yes | `{ worktreePath, syntaxAware? }` | `{ success, diff, diffMode }` |
| `POST` | `/v1/git/modified-files` | Yes | `{ worktreePath }` | `{ success, files[] }` |
| `POST` | `/v1/pty/create` | Yes | `{ taskId, cwd?, customEnv?, subscriberId? }` | `{ success, created, running, restarted }` |
| `POST` | `/v1/pty/attach` | Yes | `{ taskId, subscriberId? }` | `{ success, state }` |
| `POST` | `/v1/pty/detach` | Yes | `{ taskId, subscriberId? }` | `{ success }` |
| `POST` | `/v1/pty/write` | Yes | `{ taskId, data }` | `{ success, error? }` |
| `POST` | `/v1/pty/resize` | Yes | `{ taskId, cols, rows }` | `{ success, error? }` |
| `POST` | `/v1/pty/destroy` | Yes | `{ taskId }` | `{ success }` |

`git/worktree/create` options:
- `createBaseBranchIfMissing: boolean`
- `dependencyCloneMode: "copy_on_write" | "full_copy"`
- `packageStoreStrategy: "off" | "pnpm_global" | "polyglot_global"`
- `pnpmStorePath: string`
- `sharedCacheRoot: string`
- `pnpmAutoInstall: boolean`

## Error semantics

- `400`: invalid request fields (task id/path/body)
- `403`: unauthorized, non-loopback, or browser-origin request
- `404`: missing route/session
- `405`: `OPTIONS` rejected
- `409`: PTY/session conflict
- `413`: body/write payload too large
- `429`: rate limit or SSE cap reached
- `500`: unhandled runtime error
