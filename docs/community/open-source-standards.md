# Open Source Standards

Forkline repository standards include:

- MIT `LICENSE`
- `README.md` with install/run/security context
- `CONTRIBUTING.md` for contribution policy
- `CODE_OF_CONDUCT.md` for community behavior
- `SECURITY.md` for vulnerability disclosure
- `SUPPORT.md` for help channels
- `GOVERNANCE.md` for decision model
- CI + security workflows in `.github/workflows/`

## Maintainer expectations

- evaluate security impact for architecture and API changes
- keep protocol and runtime behavior in sync
- ensure docs stay current with feature changes
- treat breaking changes as explicit and documented

## Required docs for major features

When adding a significant feature, include:

1. user-facing guide updates
2. API reference updates (if routes/events changed)
3. security and operational implications
4. migration notes for behavior changes
