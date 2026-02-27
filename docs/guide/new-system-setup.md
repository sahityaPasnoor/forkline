# New System Setup (Step by Step)

Use this guide to set up Forkline on a fresh machine from zero to a working app.

## 1. Install prerequisites

Install these first:
- Node.js `20+`
- npm `10+`
- Git
- one supported agent CLI in `PATH` (`claude`, `gemini`, `codex`, `aider`, or `amp`)

Verify:

```bash
node -v
npm -v
git --version
which claude || true
which gemini || true
which codex || true
which aider || true
which amp || true
```

## 2. Clone the repository

```bash
git clone https://github.com/sahityaPasnoor/forkline.git
cd forkline
```

## 3. Install dependencies

```bash
npm ci
```

If `npm ci` fails due to old Node/npm, upgrade Node to `20+` and rerun `npm ci`.

## 4. Build once to validate local setup

```bash
npm run typecheck
npm run build
```

Expected result:
- no TypeScript errors
- `dist/` output generated

## 5. Run the app in development mode

```bash
npm run dev
```

This starts:
- Vite renderer dev server
- Electron TypeScript watcher
- Electron app window

## 6. Run headless core daemon (optional)

In a separate terminal:

```bash
npm run core:start
```

On first run, Forkline creates an auth token file:
- `~/.forkline/core.token`

Health check:

```bash
curl -i http://127.0.0.1:34600/v1/health
TOKEN=$(cat ~/.forkline/core.token)
curl -i -H "Authorization: Bearer $TOKEN" http://127.0.0.1:34600/v1/pty/sessions
```

## 7. Configure your first project in GUI

1. Open Forkline.
2. Select your repository folder.
3. Open **Settings** and set:
- default command
- project memory/context
- optional environment variables for task runs
4. Create a task.
5. Select an available agent CLI.
6. Spawn agent and confirm terminal output appears.

## 8. Run quality checks before normal use

```bash
npm run security:smoke
npm run test:core
npm run test:pty-replay
```

Optional E2E smoke:

```bash
npx playwright test e2e/electron.smoke.spec.js
```

## 9. Build production-style artifacts locally

```bash
npm run dist:local
```

This creates release artifacts in `release/`.

You can also simulate package install:

```bash
npm pack
npm install -g --offline ./forkline-<version>.tgz
forkline
forkline-core
```

## 10. Common troubleshooting

### `PTY startup failed: posix_spawnp failed`
- Ensure shell executable exists and is executable.
- Confirm system can spawn `sh`.
- Restart app after fixing shell path/permissions.

### Agent command not visible in dropdown
- Forkline only shows supported commands found in `PATH`.
- Install the CLI and restart Forkline.

### `setRawMode EPERM`
- Usually means the child process is not attached to a valid TTY.
- Relaunch agent from Forkline terminal session (not detached process context).

### Docs build failures
Run:

```bash
npm run docs:build
```

Fix any dead links or invalid markdown references shown in the output.

## 11. Upgrade flow on an existing machine

```bash
git fetch origin
git checkout main
git pull --ff-only
npm ci
npm run build
```

If runtime behavior changed, also rerun:

```bash
npm run security:smoke
npm run test:core
```

## 12. What is persisted locally

Forkline stores local app state under macOS paths like:
- `~/Library/Application Support/Forkline/workspace.json`
- `~/Library/Application Support/Forkline/runtime-session.json`
- `~/Library/Application Support/Forkline/fleet.sqlite`
- `~/.forkline/core.token`

Workspace env vars entered in Settings are intended for runtime use and are not saved in workspace store payload by app code.

## 13. Next docs

- [Getting Started](/guide/getting-started)
- [How To Use](/guide/how-to-use)
- [Project Dossier](/guide/project-dossier)
- [Core API](/reference/core-api)
