# Forkline Release Playbook

## 1. Prerequisites

- Node.js 20+
- npm 10+
- GitHub repository access
- npm package ownership for `forkline`
- CI secrets configured in GitHub:
  - `NPM_TOKEN` (for npm publish)
  - `GITHUB_TOKEN` is provided automatically by Actions

## 2. Local preflight

From repository root:

```bash
npm ci
npm run preflight:release
```

This validates:

- dependency vulnerability audit (`npm audit`)
- core daemon security smoke test (`security:smoke`)
- TypeScript checks pass (`web` + `electron`)
- Build artifacts are generated
- npm tarball includes required runtime modules (`packages/core`, `packages/tui`, protocol)
- electron-builder includes required runtime files in desktop packaging

Note: `packages/tui` is shipped but considered experimental.

## 3. Build local desktop installers

```bash
npm run dist:local
```

Artifacts are written to `release/`:

- `Forkline-<version>-mac-<arch>.zip`
- blockmaps + update metadata

## 4. Build npm tarball (optional local verification)

```bash
npm pack
```

Expected output:

- `forkline-<version>.tgz`

## 5. Publish release

1. Bump version in `package.json`.
2. Commit release changes.
3. Create and push tag:

```bash
git tag vX.Y.Z
git push origin main --tags
```

GitHub Actions `release.yml` will:

- run `preflight:release`
- build and publish desktop artifacts
- generate and upload SBOM artifacts (CycloneDX + SPDX)
- attach SBOM files to the GitHub release
- publish npm package with `--provenance` when `NPM_TOKEN` is configured
- generate a build attestation for the npm tarball

## 6. Post-release verification

Check npm:

```bash
npm view forkline version
```

Check release assets:

- desktop installers for each platform
- `sbom.cdx.json`
- `sbom.spdx.json`

Check npm provenance:

- In npm package details, verify provenance is present for the published version.

Check install paths:

```bash
npx forkline@latest
npx --package forkline forkline-core
```

Optional (experimental):

```bash
npx --package forkline forkline-tui
```
