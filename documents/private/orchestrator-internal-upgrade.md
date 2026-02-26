# Internal Upgrade Notes (Private)

This file is intentionally private to the local workspace and excluded from open-source docs.

## Scope delivered

The following upgrades were implemented across `core` and `gui` with architecture separation preserved:

1. CoW/reflink dependency duplication + polyglot dependency-directory dedupe workflow.
2. Global package-store policy with pnpm and polyglot shared-cache strategies.
3. Dynamic resource allocator with injected `PORT`, `ASPNETCORE_URLS`, and session IDs.
4. Syntax-aware diff integration (Difftastic fallback model) + flight-deck aggregation UI.
5. OS-level sandbox wrapper and network guardrails (best-effort per host capability).
6. Mission-control UX upgrades (project rail, expanded sidebar context, briefing pane, command palette).

## Architecture boundaries

### Core-only logic

- `packages/core/src/services/living-spec-service.js`
  - Living spec detection, preference sanitization, canonical doc generation.
- `packages/core/src/services/resource-allocator.js`
  - Runtime port and session assignment lifecycle.
- `packages/core/src/services/sandbox-service.js`
  - Sandbox launch wrappers (`seatbelt`, `firejail`) and network blocking mode.
- `packages/core/src/services/git-service.js`
  - Worktree dependency bootstrap policies and syntax-aware diff execution.
- `packages/core/src/services/pty-service.js`
  - Resource-env injection, sandboxed command launch, session flight-deck previews.

### GUI/Electron orchestration

- `electron/main.ts`
  - IPC glue: detects spec candidates, prepares workspace cache, persists workspace policy.
- `electron/gitManager.ts`, `electron/preload.ts`
  - Contract wiring for new options (`createWorktree`, `getDiff`).

### Renderer/UI only

- `src/hooks/useOrchestrator.ts`
  - User decision flow for living spec selection and project-level preference persistence.
- `src/components/LivingSpecModal.tsx`
  - Modal for “pick one vs consolidate all”.
- `src/components/FlightDeckModal.tsx`
  - Multi-session status board with output tails.
- `src/components/DiffViewer.tsx`
  - Syntax-aware toggle with fallback visibility.
- `src/App.tsx`
  - Mission-control rail + command palette + briefing pane integration.
- `src/components/SettingsModal.tsx`
  - Policy controls for package store and sandbox/network behavior.

## Feature details

### 1) CoW/reflink dependency duplication

Implemented in `git-service.createWorktree(...)` post-worktree creation stage:

- Core policy detects ecosystem hints and copies dependency-heavy directories by clone mode:
  - `copy_on_write`: tries reflink (`cp -R -c` macOS / `cp -R --reflink=always` Linux), then hardlink (`cp -a -l`).
  - `full_copy`: uses recursive copy fallback for compatibility.
- Targets include language-specific directories when policy is `polyglot_global` (for example `.venv`, `Pods`, `.gradle`, `vendor`, `.dart_tool`) plus `node_modules` compatibility path.

Result is returned as structured `dependencyBootstrap.cloneResults`.

### 2) Global store strategy and automation

Workspace policy fields persisted:

- `packageStoreStrategy`: `off | pnpm_global | polyglot_global`
- `dependencyCloneMode`: `copy_on_write | full_copy`
- `pnpmStorePath`: absolute path
- `sharedCacheRoot`: absolute path
- `pnpmAutoInstall`: boolean

If strategy is `pnpm_global` or `polyglot_global` and `pnpm-lock.yaml` exists:

- `PNPM_STORE_PATH` is set to configured path (or `~/.pnpm-store`).
- Optional auto-install runs `pnpm install --frozen-lockfile --prefer-offline`.

If strategy is `polyglot_global`, core also injects shared cache env vars at PTY launch for common toolchains:

- Node (`npm`, `yarn`, `pnpm`, `bun`)
- Python (`pip`, `uv`, `poetry`)
- .NET (`nuget`)
- Java/Android (`gradle`)
- Rust (`cargo`)
- Go (`gomodcache`, `gocache`)
- PHP (`composer`)
- Ruby (`bundler`)
- iOS (`cocoapods`)
- Flutter/Dart (`pub`)

### 3) Dynamic port and session injection

`pty-service` now allocates per-task runtime resources via `ResourceAllocator` and injects:

- `PORT`
- `HOST`
- `ASPNETCORE_URLS`
- `CONDUCTOR_SESSION_ID`
- `FORKLINE_SESSION_ID`
- `FORKLINE_ALLOCATED_PORT`

Assignments are released when PTY session is destroyed.

### 4) Syntax-aware diff + flight deck

#### Syntax-aware diff

`DiffViewer` adds `syntax-aware diff` toggle.

- Backend uses Difftastic (`difft --git`) when available.
- Automatic fallback to plain git diff.
- UI surfaces active diff mode.

#### Flight deck

`pty-service.listSessions()` now includes:

- `tailPreview`: last 3 non-empty lines of output,
- `resource`: assigned port/session details,
- `sandbox`: active sandbox metadata.

Renderer provides `Flight Deck` modal summarizing all active sessions and quick-jump to task.

### 5) Sandbox wrapper and network guardrails

Best-effort wrappers are enabled by env policy:

- `FORKLINE_SANDBOX_MODE`: `off | auto | seatbelt | firejail`
- `FORKLINE_NETWORK_GUARD`: `off | none`

Behavior:

- macOS + seatbelt: `sandbox-exec` with generated profile.
- Linux + firejail: `firejail --private=<cwd> --whitelist=<cwd> [--net=none] -- <shell>`
- Missing runtime wrappers are reported as orchestrator warnings in terminal stream.

### 6) Mission-control UX redesign

Implemented UX building blocks:

- Slim project rail on far left with status badges.
- Existing sidebar retained as expanded task/worktree list.
- Briefing strip above terminal showing objective and latest execution lines.
- Command palette (`Cmd/Ctrl+K`) for direct `Project` and `Task` jump.
- Flight Deck button in header for fleet-level snapshot.

## Living spec enforcement update

- Canonical per-task living spec file path: `.agent_cache/FORKLINE_SPEC.md`.
- No new repo-level spec authoring required.
- If multiple agentic files exist, user must choose one source or consolidate all.

## Runtime knobs summary

- Dependency policy:
  - `packageStoreStrategy`, `dependencyCloneMode`, `pnpmStorePath`, `sharedCacheRoot`, `pnpmAutoInstall`
- Sandbox/network policy (propagated into PTY env):
  - `FORKLINE_SANDBOX_MODE`
  - `FORKLINE_NETWORK_GUARD`

## Validation status

- Typecheck: `npm run typecheck` passed.
- Build: `npm run build` passed.

## Known operational caveats

- Reflink/hardlink behavior varies by host filesystem and platform utilities.
- `sandbox-exec` and `firejail` availability is host-dependent.
- Difftastic integration is opportunistic; plain diff remains fallback.
