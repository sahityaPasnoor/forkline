# Quick Actions

Quick actions are deterministic plans that convert operator intent into PTY instructions.

## Actions

- `status`
- `resume`
- `pause`
- `test_and_fix`
- `plan`
- `context`
- `cost`

## Capability detection

Agent command is classified into one profile:

- `aider`: supports `/ask` and `/run`
- `prompt`: prompt-style agents (`claude`, `codex`, `gemini`, `amp`, `cursor`, `cline`, `sweep`)
- `shell`: generic shell behavior

## Blocked-session behavior

When session is blocked:

- `resume` sends `y` without clearing line
- other actions emit a hint and do not execute

## Example planning behavior

| Action | Shell profile | Prompt profile |
|---|---|---|
| `status` | send git shell command | ask agent for git status summary |
| `test_and_fix` | run test command chain | instruct agent to run/fix tests |
| `plan` | sends instruction line | sends instruction line |
| `pause` | sends `Ctrl+C` | sends `Ctrl+C` |

Implementation source:

- `packages/protocol/src/quick-actions.js`
- `src/lib/quickActions.ts`
