# Open-Source Readiness Audit (2026-02)

Audit basis:
- Compare target: `origin/codex/dev`
- Generated at (UTC): `2026-02-25T02:50:30Z`
- Tracked files in repository (git ls-files): `136`
- Push-scope files (git diff --name-only origin/codex/dev + untracked additions): `69`

Method:
1. Build file manifest from tracked repo content and push-scope diff.
2. Review each push-scope file against security/runtime/ipc/ui/docs/release risks.
3. Record findings and disposition per file (fixed, accepted-risk, deferred).
4. Gate critical issues via tests/build/security checks prior to merge.

Risk classes:
- security
- runtime
- ipc
- ui/ux
- docs
- ci/release

## Per-File Manifest

| File | Last touch commit/date | Risk class | Findings | Disposition | Notes |
|---|---|---|---:|---|---|
| `AGENTS.md` | `ea349a0 (2026-02-24)` | `docs` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `README.md` | `ea349a0 (2026-02-24)` | `docs` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `docs/.vitepress/config.mts` | `017cd20 (2026-02-23)` | `docs` | 1 | `fixed` | Documentation aligned to implemented contracts and wired into docs navigation. |
| `docs/reference/agent-control-api.md` | `ea349a0 (2026-02-24)` | `docs` | 1 | `fixed` | Documentation aligned to implemented contracts and wired into docs navigation. |
| `docs/reference/core-api.md` | `69423a6 (2026-02-23)` | `docs` | 1 | `fixed` | Documentation aligned to implemented contracts and wired into docs navigation. |
| `docs/reference/environment-variables.md` | `ea349a0 (2026-02-24)` | `docs` | 1 | `fixed` | Documentation aligned to implemented contracts and wired into docs navigation. |
| `docs/reference/events.md` | `69423a6 (2026-02-23)` | `docs` | 1 | `fixed` | Documentation aligned to implemented contracts and wired into docs navigation. |
| `docs/reference/protocol-api.md` | `working-tree (uncommitted)` | `docs` | 1 | `fixed` | Documentation aligned to implemented contracts and wired into docs navigation. |
| `docs/reference/quick-actions.md` | `69423a6 (2026-02-23)` | `docs` | 1 | `fixed` | Documentation aligned to implemented contracts and wired into docs navigation. |
| `docs/reference/renderer-ipc-internal.md` | `working-tree (uncommitted)` | `docs` | 1 | `fixed` | Documentation aligned to implemented contracts and wired into docs navigation. |
| `docs/reference/tui-api.md` | `working-tree (uncommitted)` | `docs` | 1 | `fixed` | Documentation aligned to implemented contracts and wired into docs navigation. |
| `documents/project_summary.md` | `ea349a0 (2026-02-24)` | `docs` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `documents/pty-replay-fixtures/01-claude-blocked-and-resume.json` | `710e1ec (2026-02-24)` | `docs` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `documents/pty-replay-fixtures/02-gemini-tui-no-block.json` | `710e1ec (2026-02-24)` | `docs` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `documents/pty-replay-fixtures/03-shell-recovery.json` | `710e1ec (2026-02-24)` | `docs` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `documents/pty-replay-fixtures/04-wrapper-lifecycle.json` | `710e1ec (2026-02-24)` | `docs` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `documents/pty-replay-fixtures/05-normalized-block-reason.json` | `710e1ec (2026-02-24)` | `docs` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `documents/pty-replay-fixtures/06-da-response-stays-unblocked.json` | `710e1ec (2026-02-24)` | `docs` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `documents/pty-replay-fixtures/07-multi-provider-markers.json` | `710e1ec (2026-02-24)` | `docs` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `documents/pty-replay-fixtures/08-pause-twice-shell-stable.json` | `710e1ec (2026-02-24)` | `docs` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `documents/pty-replay-fixtures/09-da-then-tui-no-corruption.json` | `710e1ec (2026-02-24)` | `docs` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `documents/pty-replay-fixtures/10-marker-confirmation-resolved.json` | `710e1ec (2026-02-24)` | `docs` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `e2e/electron.smoke.spec.js` | `017cd20 (2026-02-23)` | `ui/ux` | 1 | `fixed` | Stabilized smoke test startup and readiness waits to reduce timeout flakiness. |
| `electron/agentServer.ts` | `710e1ec (2026-02-24)` | `security` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `electron/fleetStore.ts` | `710e1ec (2026-02-24)` | `runtime` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `electron/gitManager.ts` | `710e1ec (2026-02-24)` | `runtime` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `electron/main.ts` | `710e1ec (2026-02-24)` | `runtime` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `electron/preload.ts` | `710e1ec (2026-02-24)` | `ipc` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `electron/ptyManager.ts` | `710e1ec (2026-02-24)` | `runtime` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `package.json` | `ea349a0 (2026-02-24)` | `ci/release` | 1 | `fixed` | Added core/protocol node:test command for release validation. |
| `packages/core/src/daemon.js` | `710e1ec (2026-02-24)` | `security` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `packages/core/src/services/git-service.js` | `710e1ec (2026-02-24)` | `runtime` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `packages/core/src/services/living-spec-service.js` | `710e1ec (2026-02-24)` | `runtime` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `packages/core/src/services/pty-service.js` | `710e1ec (2026-02-24)` | `runtime` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `packages/core/test/daemon.integration.test.js` | `working-tree (uncommitted)` | `runtime` | 1 | `fixed` | Added behavior-first tests for core and protocol contracts. |
| `packages/core/test/git-service.test.js` | `working-tree (uncommitted)` | `runtime` | 1 | `fixed` | Added behavior-first tests for core and protocol contracts. |
| `packages/core/test/pty-service.test.js` | `working-tree (uncommitted)` | `runtime` | 1 | `fixed` | Added behavior-first tests for core and protocol contracts. |
| `packages/protocol/src/index.js` | `710e1ec (2026-02-24)` | `ipc` | 1 | `fixed` | Added missing route constants for implemented diff and modified-files endpoints. |
| `packages/protocol/src/pty-state-machine.js` | `710e1ec (2026-02-24)` | `ipc` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `packages/protocol/test/pty-state-machine.test.js` | `working-tree (uncommitted)` | `ipc` | 1 | `fixed` | Added behavior-first tests for core and protocol contracts. |
| `packages/tui/src/index.js` | `710e1ec (2026-02-24)` | `runtime` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `scripts/css-hardcode-audit.js` | `ea349a0 (2026-02-24)` | `ci/release` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `scripts/pty-replay-harness.js` | `710e1ec (2026-02-24)` | `ci/release` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `src/App.tsx` | `ba2bb61 (2026-02-24)` | `ui/ux` | 1 | `fixed` | Blocking error prompts were replaced with non-blocking operation notices. |
| `src/components/ApprovalInboxModal.tsx` | `ba2bb61 (2026-02-24)` | `ui/ux` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `src/components/ApprovalModal.tsx` | `ba2bb61 (2026-02-24)` | `ui/ux` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `src/components/DiffViewer.tsx` | `ba2bb61 (2026-02-24)` | `ui/ux` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `src/components/FleetDashboardModal.tsx` | `ba2bb61 (2026-02-24)` | `ui/ux` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `src/components/FlightDeckModal.tsx` | `ba2bb61 (2026-02-24)` | `ui/ux` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `src/components/HandoverModal.tsx` | `ba2bb61 (2026-02-24)` | `ui/ux` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `src/components/LivingSpecModal.tsx` | `ba2bb61 (2026-02-24)` | `ui/ux` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `src/components/NewTaskModal.tsx` | `ba2bb61 (2026-02-24)` | `ui/ux` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `src/components/ProjectManagerModal.tsx` | `ba2bb61 (2026-02-24)` | `ui/ux` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `src/components/SettingsModal.tsx` | `ba2bb61 (2026-02-24)` | `ui/ux` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `src/components/Sidebar.tsx` | `ba2bb61 (2026-02-24)` | `ui/ux` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `src/components/SplitTaskModal.tsx` | `ba2bb61 (2026-02-24)` | `ui/ux` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `src/components/Terminal.tsx` | `ba2bb61 (2026-02-24)` | `ui/ux` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `src/components/WorktreeInventoryModal.tsx` | `ba2bb61 (2026-02-24)` | `ui/ux` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `src/global.d.ts` | `ba2bb61 (2026-02-24)` | `ipc` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `src/hooks/useOrchestrator.ts` | `ba2bb61 (2026-02-24)` | `runtime` | 1 | `fixed` | Removed remaining blocking alert path in approval merge flow and routed failure to attention stream. |
| `src/index.css` | `ba2bb61 (2026-02-24)` | `ui/ux` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `src/lib/agentProfiles.ts` | `ba2bb61 (2026-02-24)` | `runtime` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `src/lib/handover.ts` | `ba2bb61 (2026-02-24)` | `runtime` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `src/lib/handoverAdapters.ts` | `ba2bb61 (2026-02-24)` | `runtime` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `src/lib/quickActions.ts` | `ba2bb61 (2026-02-24)` | `runtime` | 1 | `deferred` | Quick-action set intentionally differs from protocol path by adding GUI-specific create_pr. |
| `src/lib/shell.ts` | `ba2bb61 (2026-02-24)` | `runtime` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `src/models/fleet.ts` | `ba2bb61 (2026-02-24)` | `ui/ux` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `src/models/orchestrator.ts` | `ba2bb61 (2026-02-24)` | `ui/ux` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |
| `src/types.ts` | `ba2bb61 (2026-02-24)` | `ui/ux` | 0 | `accepted-risk` | No blocking issues identified in this audit pass. |

## Summary

- Total push-scope files reviewed: 69
- Total findings logged: 19
- Disposition totals:
  - fixed: 18
  - accepted-risk: 50
  - deferred: 1
- Risk class distribution:
  - security: 2
  - runtime: 17
  - ipc: 5
  - ui/ux: 20
  - docs: 22
  - ci/release: 3

## Deferred Items

1. Quick-action parity is currently runtime-specific (protocol supports context and cost; GUI supports create_pr). This is documented and retained for backward compatibility in this cycle.

## Exit Criteria For Merge

The following gates must pass before merging into codex/dev:
- npm run test:core
- npm run typecheck
- npm run build
- npm run docs:build
- npm run security:smoke
- npm audit (no moderate/high/critical)
- npm run test:pty-replay
- npx playwright test e2e/electron.smoke.spec.js
- npm run preflight:release
