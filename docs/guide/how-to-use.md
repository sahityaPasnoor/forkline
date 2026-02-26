# How To Use Forkline

## 1. Start Forkline

### Desktop app (packaged install)

```bash
forkline
```

### GUI development mode

```bash
npm run dev
```

### Headless core (packaged install)

```bash
forkline-core
```

### Headless core from source

```bash
npm run core:start
```

## 2. Use the project in GUI

1. Select your repository folder.
2. Create a task (this creates a dedicated worktree + branch).
3. Choose launch mode:
   - `Start New Session` for a fresh agent run.
   - `Resume Existing` for an ephemeral provider picker.
     - Resume is available for `claude`, `codex`, `gemini`, and `amp`.
     - Other providers should use `Start New Session`.
     - Gemini/Amp: Forkline shows live sessions to pick from.
     - Claude/Codex: use latest, manual session id, or provider picker in terminal.
4. Optional: in `Spawn Agent`, enable `Bypass agent permission prompts` for this task.
   - Forkline appends provider flags only when supported:
     - `claude`: `--permission-mode bypassPermissions`
     - `codex`: `--dangerously-bypass-approvals-and-sandbox`
     - `gemini`: `--approval-mode yolo`
     - `amp`: `--dangerously-allow-all`
   - Unsupported agents keep normal approval behavior.
5. Work inside the task terminal.
6. Review diff/status.
7. Merge task branch or delete task worktree.

## 3. Use the project in headless mode

1. Start core daemon.
2. Read token:

```bash
TOKEN=$(cat ~/.forkline/core.token)
```

3. Create a PTY session:

```bash
curl -s -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -X POST http://127.0.0.1:34600/v1/pty/create \
  -d '{"taskId":"task-1","cwd":"/absolute/path/to/repo"}'
```

4. Check PTY state:

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:34600/v1/pty/sessions
```

Only write to the session when the target task shows `"running": true`.

5. Write commands to the session:

```bash
curl -s -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -X POST http://127.0.0.1:34600/v1/pty/write \
  -d '{"taskId":"task-1","data":"git status\r"}'
```

If `/v1/pty/create` returns `"running": false`, the session exists but the PTY process did not start. In that state, `/v1/pty/write` returns `409` with `PTY is not running for this task.`.

## 4. Typical task lifecycle

- Validate source path (`/v1/git/validate`)
- Create worktree (`/v1/git/worktree/create`)
- Work in PTY (`/v1/pty/create`, `/v1/pty/write`)
- Review changes (`/v1/git/diff`, `/v1/git/modified-files`)
- Merge and cleanup (`/v1/git/worktree/merge` or `/v1/git/worktree/remove`)

See the full endpoint table in [Core API](/reference/core-api).

## 5. Resolve collision warnings (GUI)

Forkline now scopes collisions per project. A collision banner only appears in the active project where overlapping file edits exist.

Use the banner actions:

1. `Re-check` to refresh current project collision state.
2. `How to fix` to view guided steps.
3. `Dismiss` to hide the current collision snapshot for that project until the collision set changes.
