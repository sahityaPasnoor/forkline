# Forkline

Forkline is a local-first desktop IDE for orchestrating multiple terminal-based coding agents in parallel, each isolated in its own git worktree.

## Why Forkline

- Run many agent sessions without terminal sprawl.
- Keep agents isolated by branch/worktree to reduce collisions.
- Monitor blocked sessions, approvals, and task status from one interface.
- Manage project context and quick actions without leaving the terminal flow.

## Current Status

Alpha. Core workflows work, but APIs and UI details may change.

## Tech Stack

- Electron (main/preload)
- React + TypeScript + Vite
- Tailwind CSS
- xterm.js + node-pty
- simple-git
- sql.js (fleet/task persistence)

## Runtime Surfaces

Forkline is now structured as three surfaces:

- `core`: headless daemon engine (`packages/core`) for PTY sessions, Git worktrees, and local API.
- `tui`: terminal UI client (`packages/tui`) that talks to core over HTTP + SSE.
- `gui`: Electron/React app (current root app; boundary documented in `packages/gui`).

Shared protocol constants live in `packages/protocol`.

## Quick Start

### Requirements

- Node.js 20+
- npm 10+
- Git installed and available in `PATH`

### Install

```bash
npm ci
```

### Run in development

```bash
npm run dev
```

This starts:

- Vite dev server defaults to `http://localhost:5555` (auto-falls back to next free port)
- Electron main/watch processes
- Local control server on `127.0.0.1:34567` (inside Electron, auto-falls back to next free port if occupied)

### Run Core + TUI + GUI

From a source checkout:

```bash
# Core daemon
npm run core:start

# Terminal UI client (new terminal)
npm run tui:start

# GUI app (new terminal)
npm run gui:start
```

Defaults:
- core listens on `127.0.0.1:34600`
- tui targets `http://127.0.0.1:34600` unless `FORKLINE_CORE_URL` is set

### Run via CLI

If published to npm, users can launch GUI with:

```bash
npx forkline@latest
```

Or install globally:

```bash
npm i -g forkline
forkline
```

For terminal-first commands from the published package:

```bash
forkline-core
forkline-tui
```

If Electron is not bundled in the installed package, the launcher falls back to
`npx electron@30.0.1` on first run.

### Build

```bash
npm run build
```

### Package installers locally

```bash
npm run dist:local
```

Installer artifacts are produced in `release/`.

### Typecheck

```bash
npm run typecheck
```

## Project Structure

- `electron/`: Electron main process, PTY manager, git/worktree orchestration, control server.
- `src/`: React renderer app and UI components.
- `src/hooks/`: orchestration state and behavior.
- `src/models/`: shared renderer model types.
- `documents/`: internal project docs and notes.

## Security Notes

- Forkline executes local CLI tools and shell commands in PTYs.
- Never run untrusted prompts/commands in sensitive repositories.
- API keys and credentials should be supplied locally and never committed.
- Report vulnerabilities using `SECURITY.md`.

## Contributing

See `CONTRIBUTING.md` for setup, workflow, and PR expectations.

## License

MIT. See `LICENSE`.

## Release Automation

- Tag a release commit as `vX.Y.Z`.
- Push the tag.
- GitHub Actions `release.yml` builds and publishes desktop artifacts for macOS, Linux, and Windows.
- The same workflow publishes `forkline` to npm when `NPM_TOKEN` is configured in repository secrets.
- After npm publish, users can launch with `npx forkline@latest` or `forkline` (global install).
