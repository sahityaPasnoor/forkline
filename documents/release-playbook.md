# Forkline Release Playbook

## 1. Prerequisites

- Node.js 20+
- npm 10+
- GitHub repository access
- npm package ownership for `forkline`
- macOS signing identity (optional for local test artifacts, required for signed distributables)
- CI secrets configured in GitHub:
  - `NPM_TOKEN` (for npm publish)
  - `GITHUB_TOKEN` is provided automatically by Actions

### macOS signing identity selection

Forkline packaging now disables certificate auto-discovery by default to avoid accidental signing with unintended identities.

Use your personal identity explicitly:

```bash
export FORKLINE_MAC_IDENTITY="Developer ID Application: <Your Name or Org> (<TEAMID>)"
```

Safety guard:
- values matching `block` are rejected by `scripts/run-electron-builder.js`
- if `FORKLINE_MAC_IDENTITY` is not set, mac artifacts are built unsigned

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
- npm tarball includes required runtime modules (`packages/core`, protocol)
- electron-builder includes required runtime files in desktop packaging

## 2.1 One-command automation

Base automation:

```bash
npm run release:automate
```

Full release flow example (with personal mac signing identity, version bump, push, and npm publish):

```bash
export FORKLINE_MAC_IDENTITY="Developer ID Application: <Your Name or Org> (<TEAMID>)"
npm run release:automate -- --sync-dev --sign-mac --version patch --push-main --push-tags --publish-npm
```

Optional extras:
- add `--with-pty-replay` to run replay fixtures
- add `--with-playwright` to run Electron smoke test
- add `--dry-run` to print planned commands only

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
