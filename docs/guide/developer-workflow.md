# Developer Workflow

## Typical operator flow

1. Start Forkline GUI.
2. Select a workspace.
3. Spawn task(s), each with an isolated worktree.
4. Run agent commands in task terminals.
5. Resolve blocked prompts through approval UI.
6. Review diffs, merge, and clean up worktrees.

## Core commands

```bash
npm run dev
npm run core:start
npm run tui:start:experimental
npm run typecheck
npm run build
```

## Quality and security gates

```bash
npm run security:audit
npm run security:smoke
npm run preflight:release
```

## Testing

```bash
npx playwright test e2e/electron.smoke.spec.js
```

## Branch and review guidance

- Keep PRs focused and small.
- Include screenshots/GIFs for UI changes.
- Document behavior changes and migration impact.
- Do not commit tokens or host-specific secrets.

See [Contributing](/community/contributing) for full standards.
