# Getting Started

## Prerequisites

- Node.js `20+`
- npm `10+`
- Git available in `PATH`
- macOS, Linux, or Windows development environment

## Install

```bash
npm ci
```

## Choose a runtime

### GUI (recommended)

```bash
npm run dev
```

### Core daemon (headless)

```bash
npm run core:start
```

### TUI client (experimental)

```bash
npm run tui:start:experimental
```

## Verify the installation

```bash
npm run typecheck
npm run build
```

## Manual core API verification

```bash
curl -i http://127.0.0.1:34600/v1/health
TOKEN=$(cat ~/.forkline/core.token)
curl -i -H "Authorization: Bearer $TOKEN" http://127.0.0.1:34600/v1/pty/sessions
```

## Repository map

- `packages/core/`: daemon, PTY service, Git service
- `packages/protocol/`: shared route and quick-action contracts
- `packages/tui/`: terminal-first client
- `electron/`: main process and local control server
- `src/`: React renderer
- `documents/`: architecture and operations docs
