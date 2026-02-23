# Contributing

Forkline welcomes high-signal contributions aligned with safety, correctness, and maintainability.

## Core standards

- Keep changes focused and minimal.
- Prefer deterministic behavior over implicit magic.
- Preserve terminal fidelity and avoid hiding operational state.
- Never commit credentials, tokens, or machine secrets.

## Setup

```bash
npm ci
npm run dev
```

Before opening a PR:

```bash
npm run typecheck
npm run build
```

## Pull request expectations

- clear motivation and summary
- screenshots/GIFs for UI-impacting changes
- explicit behavior/migration notes
- small reviewable scope

For issue templates and governance, see root docs:

- `CONTRIBUTING.md`
- `GOVERNANCE.md`
- `CODE_OF_CONDUCT.md`
- `SUPPORT.md`
