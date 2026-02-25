# Core API

Base URL: `http://127.0.0.1:34600`

Implementation source:
- `packages/core/src/daemon.js`
- `packages/core/src/services/git-service.js`
- `packages/core/src/services/pty-service.js`

## Authentication

Required for all non-public routes.

Accepted headers:
- `Authorization: Bearer <token>`
- `x-forkline-token: <token>`

Public routes:
- `GET /v1/health`
- `GET /v1/version`

## Run + test quickly

```bash
npm run core:start
TOKEN=$(cat ~/.forkline/core.token)

curl -s http://127.0.0.1:34600/v1/health
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:34600/v1/pty/sessions
```

## Endpoint reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/health` | Health status |
| `GET` | `/v1/version` | API/runtime version |
| `GET` | `/v1/events` | SSE event stream |
| `GET` | `/v1/pty/sessions` | List PTY sessions |
| `POST` | `/v1/git/validate` | Validate source path |
| `POST` | `/v1/git/worktree/create` | Create worktree + branch |
| `POST` | `/v1/git/worktree/list` | List worktrees |
| `POST` | `/v1/git/branches/list` | List branches |
| `POST` | `/v1/git/worktree/remove` | Remove worktree/branch |
| `POST` | `/v1/git/worktree/merge` | Merge task branch + cleanup |
| `POST` | `/v1/git/diff` | Get worktree diff |
| `POST` | `/v1/git/modified-files` | List modified files |
| `POST` | `/v1/pty/create` | Create/start PTY session |
| `POST` | `/v1/pty/attach` | Attach subscriber + output buffer |
| `POST` | `/v1/pty/detach` | Detach subscriber |
| `POST` | `/v1/pty/write` | Write input to PTY |
| `POST` | `/v1/pty/resize` | Resize terminal |
| `POST` | `/v1/pty/destroy` | Destroy PTY session |

## Common request examples

### Validate repository path

```bash
curl -s -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -X POST http://127.0.0.1:34600/v1/git/validate \
  -d '{"sourcePath":"/absolute/path/to/repo"}'
```

### Create worktree

```bash
curl -s -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -X POST http://127.0.0.1:34600/v1/git/worktree/create \
  -d '{"basePath":"/absolute/path/to/repo","taskName":"task-1","baseBranch":"main"}'
```

### Create PTY + write command

```bash
curl -s -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -X POST http://127.0.0.1:34600/v1/pty/create \
  -d '{"taskId":"task-1","cwd":"/absolute/path/to/repo-worktrees/task-1"}'

# confirm running state before write
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:34600/v1/pty/sessions

# write only when task-1 is running=true
curl -s -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -X POST http://127.0.0.1:34600/v1/pty/write \
  -d '{"taskId":"task-1","data":"npm test\r"}'
```

`/v1/pty/create` can succeed with `"running": false` when a PTY process cannot be started in the current environment. In that state, `/v1/pty/write` returns `409`.

## Response and errors

Success pattern (most POST routes):

```json
{ "success": true }
```

Failure pattern:

```json
{ "success": false, "error": "..." }
```

Common HTTP status codes:
- `400` invalid request input
- `403` unauthorized or forbidden request
- `404` route/session not found
- `409` PTY state conflict
- `413` payload too large
- `429` rate/SSE limits
- `500` server error
