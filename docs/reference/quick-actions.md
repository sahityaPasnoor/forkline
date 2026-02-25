# Quick Actions

Quick actions are deterministic plans that map operator intent to PTY input steps.

Implementation source:
- `packages/protocol/src/quick-actions.js` (core/tui)
- `src/lib/quickActions.ts` (renderer)

## Layer 1: Quickstart

Core/TUI quick action execution pattern:
1. Build action plan from `resolveQuickActionPlan(...)`.
2. Execute each step in order (`hint`, `send`, `send_line`, `launch_agent`).
3. Send generated terminal input through `/v1/pty/write` (core) or `electronAPI.writePty` (GUI).

## Layer 2: Practical recipes

- Use `status` for fast branch/dirty checks.
- Use `test_and_fix` to run default project tests without crafting commands per repo.
- Use `pause` to send `Ctrl+C` safely.
- Use `resume` only after blocked prompts are resolved.
- In GUI, use `create_pr` when branch is ready and `gh`/`glab` is installed.

## Layer 3: Runtime contracts

## Action support matrix

| Action | Protocol (`core`/`tui`) | Renderer (`gui`) |
|---|---|---|
| `status` | Yes | Yes |
| `pause` | Yes | Yes |
| `resume` | Yes | Yes |
| `test_and_fix` | Yes | Yes |
| `plan` | Yes | Yes |
| `context` | Yes | No |
| `cost` | Yes | No |
| `create_pr` | No | Yes |

## Capability profiles

Agent command is classified as:
- `aider` (supports `/ask` and `/run` adaptation)
- `prompt` (claude/codex/gemini/amp/cursor/cline/sweep)
- `shell`

## Blocked-session behavior

Protocol (`packages/protocol`):
- `resume` while blocked sends `y` without clearing line.
- Other actions return a hint to resolve prompt first.

Renderer (`src/lib/quickActions.ts`):
- `resume` sends a line to relaunch/continue the agent command.
- Other actions while blocked emit a hint and do not execute.

## PR creation behavior (GUI)

`create_pr` builds a shell command that:
- detects current branch and parent branch
- prefers `gh pr create --fill --web`
- falls back to `glab mr create --fill --web`
- otherwise prints manual command instructions

## Return shape

```json
{
  "action": "status",
  "target": "shell",
  "capabilities": { "profile": "shell", "supportsAsk": false, "supportsRun": false },
  "steps": [
    { "kind": "send_line", "line": "git status --short && echo \"---\" && git branch --show-current" }
  ]
}
```
