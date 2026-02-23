# Contributing to Forkline

Thanks for contributing.

## Ground Rules

- Keep changes focused and minimal.
- Prefer deterministic behavior over magic.
- Preserve terminal fidelity and avoid UI regressions that hide critical state.
- Do not commit secrets, tokens, or machine-specific credentials.

## Local Setup

1. Install dependencies:

```bash
npm ci
```

2. Run development mode:

```bash
npm run dev
```

3. Validate before opening a PR:

```bash
npm run typecheck
npm run build
```

## Pull Requests

- Open a PR with a clear summary and motivation.
- Include screenshots/GIFs for UI changes.
- Document behavior changes and migration impacts.
- Keep PRs small enough for review.
- Link related issues when applicable.

## Commit Guidance

- Use clear, imperative commit messages.
- Example: `simplify fleet dashboard filters`.

## Reporting Bugs

When filing issues, include:

- OS + Node + npm versions
- Repro steps
- Expected vs actual result
- Logs/screenshots if relevant

Use the issue templates in `.github/ISSUE_TEMPLATE`.

