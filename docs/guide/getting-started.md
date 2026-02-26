# Getting Started

## Prerequisites

- Node.js `20+`
- npm `10+`
- Git in `PATH`
- At least one supported agent CLI in `PATH` (`claude`, `gemini`, `codex`, `aider`, or `amp`)

Forkline only lists supported CLI commands in the agent dropdown. Editor-integrated tools without a supported local CLI command are not shown as selectable agents.

## Install options

### Option A: install from npm package (when published)

```bash
npm install -g forkline
```

As of February 25, 2026, this package is not published yet (npm returns `404` for `forkline`). Use Option B or C below today.

### Option B: install from a local tarball (production-style)

```bash
npm ci
npm pack
npm install -g --offline ./forkline-<version>.tgz
```

This installs these launch commands:
- `forkline` (desktop app)
- `forkline-core` (headless core daemon)

### Option C: run from source (for contributors)

```bash
npm ci
```

## Launch

### Desktop app (from packaged install)

```bash
forkline
```

`forkline` uses local Electron if available. If Electron is not installed, it falls back to `npx electron@35.7.5` (requires network access).

### Desktop app (from source tree, package-like launch)

```bash
npm run build
node ./bin/forkline.js
```

### Core daemon (from packaged install)

```bash
forkline-core
```

### Development mode (hot reload)

```bash
npm run dev
```

### Headless core from source

```bash
npm run core:start
```

## Verify

```bash
curl -i http://127.0.0.1:34600/v1/health
TOKEN=$(cat ~/.forkline/core.token)
curl -i -H "Authorization: Bearer $TOKEN" http://127.0.0.1:34600/v1/pty/sessions
```

Next:
- [How To Use](/guide/how-to-use)
- [Project Dossier](/guide/project-dossier)
- [Architecture](/architecture/overview)
- [Core API](/reference/core-api)
