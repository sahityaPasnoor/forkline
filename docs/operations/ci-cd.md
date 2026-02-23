# CI/CD and Quality Gates

## Workflows

- `ci.yml`: install, audit, smoke, typecheck, build
- `security.yml`: dependency review, Semgrep, CodeQL
- `release.yml`: release preflight, desktop packaging, SBOM, npm publish
- `docs.yml`: build and deploy GitHub Pages docs

## Open-source quality expectations

- deterministic build scripts
- pinned GitHub Actions where feasible
- CI must pass before merge
- security checks must remain enabled

## Recommended PR checklist

- [ ] changes documented
- [ ] tests or validation steps included
- [ ] security impact reviewed
- [ ] no secrets committed
- [ ] release notes impact considered
