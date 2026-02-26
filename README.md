# Forkline

Forkline is a local-first orchestration app for running multiple coding agents across isolated Git worktrees.

## Status

- Runtime: `gui` (stable), `core` (stable)
- npm package: not published yet (run from source or local tarball)

## Prerequisites

- Node.js `20+`
- npm `10+`
- Git in `PATH`

## Quick Start

```bash
npm ci
npm run dev
```

Headless core:

```bash
npm run core:start
```

## Build

```bash
npm run typecheck
npm run build
npm run dist:local
```

## Documentation

- Docs site content: `docs/`
- Local docs dev server: `npm run docs:dev`
- Docs build: `npm run docs:build`

## Open Source

- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
- Code of Conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- Security: [SECURITY.md](SECURITY.md)
- Governance: [GOVERNANCE.md](GOVERNANCE.md)
- Support: [SUPPORT.md](SUPPORT.md)

## License

MIT
