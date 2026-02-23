# Release Process

## Local preflight

```bash
npm ci
npm run preflight:release
```

This runs:

- `npm audit`
- security smoke test
- typecheck
- build
- packaging verification scripts

## Publish flow

1. Bump version in root `package.json`.
2. Commit and tag release:

```bash
git tag vX.Y.Z
git push origin main --tags
```

3. GitHub `release.yml` workflow builds desktop artifacts, generates SBOMs, and publishes npm package when `NPM_TOKEN` is configured.

## Release outputs

- desktop installers in GitHub release assets
- SBOM artifacts (`CycloneDX`, `SPDX`)
- npm package with provenance and attestation

See `documents/release-playbook.md` for full release checklist.
