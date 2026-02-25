# Forkline Agent Rules

Repository-specific rules for Codex agents working in this project.

## Testing
Make sure to write test cases for every implementation in core. An integration test for all the features which you are implementing.

Behavior-first rule (applies to all features):
1. Define expected behavior and edge cases first (happy path + failure path + state transition path).
2. Encode those expectations in tests/fixtures (not implementation-shaped assertions).
3. Run tests, then fix code until behavior matches expectations.
4. If tests pass but user-visible behavior is wrong, treat tests as incomplete and update them before shipping.

## Restored Session UX Invariants
- Restored tabs must never show a blank terminal area during PTY attach/relaunch. Render a visible startup progress state until real terminal output is available.
- Do not print internal bootstrap command text (for example relaunch shell command strings) into user-facing terminal output.
- Keep relaunch behavior state-driven and centralized (attach -> restore -> prepare workspace -> launch agent). Avoid one-off UI or command hacks.
- If relaunch is required because PTY was missing after app restart, surface progress and reason in UI state, not as noisy terminal log spam.

## Project Snapshot
- Product: `Forkline` (local-first multi-agent orchestration platform).
- Runtime split:
  - `src/` + `electron/`: GUI (React + Electron + TypeScript).
  - `packages/core/`: core daemon (Node.js CommonJS JavaScript).
  - `packages/protocol/`: shared protocol contract (JavaScript).
- Toolchain: Node.js `>=20`, npm (`package-lock.json` is source of truth).

## Commands
- Install: `npm ci`
- Dev GUI: `npm run dev`
- Core daemon: `npm run core:start`
- Typecheck: `npm run typecheck`
- Build: `npm run build`
- E2E smoke: `npx playwright test e2e/electron.smoke.spec.js`
- Security smoke: `npm run security:smoke`
- Release preflight: `npm run preflight:release`
- Docs: `npm run docs:dev`, `npm run docs:build`, `npm run docs:preview`

## Validation Rules
- There is no lint script configured. Do not invent lint commands unless asked to add linting.
- For `src/`, `electron/`, `vite.config.ts`, or TS config changes:
  - run `npm run typecheck`
  - run `npm run build` when behavior/build output is affected
- For `packages/core/`, auth, PTY, Git-worktree, or security boundary changes:
  - run `npm run security:smoke`
  - run `npm run typecheck` if TS files were touched
- For end-to-end UX flow changes:
  - run `npx playwright test e2e/electron.smoke.spec.js` when feasible
- For release/packaging changes (`scripts/release-preflight.js`, `package.json` files/build config, `bin/`, `packages/*/bin`):
  - run `npm run preflight:release`

## Directory Boundaries
- `src/`: renderer UI and client orchestration hooks/models.
- `electron/`: main process, preload, local control server, fleet store, PTY bridge.
- `packages/core/src/services/`: security-sensitive daemon services.
- `packages/protocol/src/`: shared action/event contracts used across runtimes.
- `docs/` and `documents/`: user/operator docs and internal architecture/security docs.

## Core vs GUI Ownership
- Put application functionality and business/runtime logic in `packages/core` (and shared contracts in `packages/protocol` when needed).
- Keep GUI layers (`src/` and `electron/`) focused on UI concerns: rendering, user input handling, view state, and transport/adapter wiring.
- Do not introduce new domain/business logic in GUI code when it can live in core; extract it to core and call it through existing boundaries.

## Implementation Conventions
- Keep changes minimal and focused; avoid broad refactors.
- Match existing module style per area:
  - TypeScript + ESM imports in `src/` and `electron/`
  - CommonJS (`require`, `module.exports`) in `packages/*` JS and `scripts/`
- Preserve `.editorconfig` defaults: UTF-8, LF, 2-space indent, final newline.
- Avoid adding dependencies unless required for the requested outcome.
- Do not modify public behavior/contracts without updating affected docs and call sites.

## Security Invariants (Do Not Regress)
- Maintain loopback-only control surfaces (`127.0.0.1`/`::1`) for local HTTP services.
- Preserve token auth checks for non-public endpoints.
- Preserve browser-origin rejection for localhost control APIs.
- Keep payload limits, rate limits, and PTY/session caps intact unless explicitly changed.
- Keep task-id/path validation strict; do not loosen input validation silently.
- Never persist secrets/tokens in tracked files or logs.

## Docs and API Hygiene
- If runtime behavior or API contracts change, update relevant docs in:
  - `docs/reference/`
  - `docs/guide/`
  - `README.md` when user-facing commands/flows change
- For security model changes, update `SECURITY.md` and/or `documents/threat-model.md`.

## Generated and Local-Only Artifacts
- Do not hand-edit generated output directories: `dist/`, `release/`, `test-results/`, `.tmp-playwright/`, `docs/.vitepress/cache/`.
- Avoid committing machine-specific or secret-bearing files (`.env*` except `.env.example`, local tokens, private docs content).

## Git Safety
- Never revert or overwrite user-authored changes outside the requested scope.
- Do not use destructive git commands unless explicitly requested.

## Priority
- System/developer instructions override this file.
- Otherwise, follow this file for repository-specific behavior.
