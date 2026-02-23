# Troubleshooting

## Core daemon returns `403 Unauthorized`

- Ensure you send either:
  - `Authorization: Bearer <token>`
  - `x-forkline-token: <token>`
- Confirm token source:
  - `FORKLINE_CORE_TOKEN`
  - `FORKLINE_CORE_TOKEN_FILE`
  - `~/.forkline/core.token`

## PTY session does not start

- Verify task id matches `^[a-zA-Z0-9._-]{1,128}$`.
- Check session cap (`FORKLINE_CORE_MAX_PTY_SESSIONS`).
- Confirm shell exists in environment (`$SHELL` on Unix).

## Worktree create fails

- Use safe task names: letters, numbers, `.`, `_`, `-`.
- Ensure target path does not already exist as a non-worktree directory.
- Verify base path is an accessible absolute directory.

## `403` when calling from browser tools

This is expected for local browser-origin calls. Forkline explicitly blocks cross-origin browser traffic to localhost control surfaces.

## Release preflight fails

Run these directly to isolate the issue:

```bash
npm run security:audit
npm run security:smoke
npm run typecheck
npm run build
```

For operational support paths, see `SUPPORT.md`.
