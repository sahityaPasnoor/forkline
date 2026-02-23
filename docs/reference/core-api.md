# Core API Reference

Base URL: `http://127.0.0.1:34600`

## Authentication

Required for all non-public endpoints.

Accepted headers:

- `Authorization: Bearer <token>`
- `x-forkline-token: <token>`

Public endpoints:

- `GET /v1/health`
- `GET /v1/version`

## Security and transport rules

- Loopback-only remote addresses are accepted.
- Requests with `Origin` header are rejected.
- Global rate limit is enforced per remote address.
- Payload size and PTY write-size limits are enforced.

## Endpoint matrix

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/v1/health` | No | Health and auth mode |
| `GET` | `/v1/version` | No | API and runtime version |
| `GET` | `/v1/events` | Yes | SSE event stream |
| `GET` | `/v1/pty/sessions` | Yes | List PTY sessions |
| `POST` | `/v1/git/validate` | Yes | Validate source path |
| `POST` | `/v1/git/worktree/create` | Yes | Create worktree/branch |
| `POST` | `/v1/git/worktree/list` | Yes | List worktrees |
| `POST` | `/v1/git/branches/list` | Yes | List local+remote branches |
| `POST` | `/v1/git/worktree/remove` | Yes | Remove worktree/branch |
| `POST` | `/v1/git/worktree/merge` | Yes | Merge task branch and clean up |
| `POST` | `/v1/git/diff` | Yes | Get diff for worktree |
| `POST` | `/v1/git/modified-files` | Yes | List modified files (filtered) |
| `POST` | `/v1/pty/create` | Yes | Create/start PTY session |
| `POST` | `/v1/pty/attach` | Yes | Attach subscriber and get buffer |
| `POST` | `/v1/pty/detach` | Yes | Detach subscriber |
| `POST` | `/v1/pty/write` | Yes | Write input to PTY |
| `POST` | `/v1/pty/resize` | Yes | Resize terminal |
| `POST` | `/v1/pty/destroy` | Yes | Destroy PTY session |

## Request and response examples

### `POST /v1/git/worktree/create`

```json
{
  "basePath": "/absolute/path/to/repo",
  "taskName": "auth-refactor",
  "baseBranch": "main"
}
```

Success:

```json
{
  "success": true,
  "worktreePath": "/absolute/path/to/repo-worktrees/auth-refactor"
}
```

### `POST /v1/pty/create`

```json
{
  "taskId": "auth-refactor",
  "cwd": "/absolute/path/to/repo-worktrees/auth-refactor",
  "subscriberId": "gui",
  "customEnv": {
    "FORKLINE_MODE": "agent"
  }
}
```

Success:

```json
{
  "success": true,
  "created": true,
  "running": true,
  "restarted": false
}
```

### `POST /v1/pty/write`

```json
{
  "taskId": "auth-refactor",
  "data": "npm test\r"
}
```

Success:

```json
{
  "success": true
}
```

## Error semantics

- `400`: input validation failure
- `403`: unauthorized, non-loopback, or browser-origin request
- `404`: unknown route or missing session (route-specific)
- `409`: PTY state conflict (for example write to stopped session)
- `413`: request or PTY write payload too large
- `429`: rate limit or SSE client cap exceeded
- `500`: unexpected server error

## Implementation source

- `packages/core/src/daemon.js`
- `packages/core/src/services/git-service.js`
- `packages/core/src/services/pty-service.js`
