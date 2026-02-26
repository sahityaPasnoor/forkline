# Changelog

All notable changes to this project are documented in this file.

The format loosely follows Keep a Changelog.

## [Unreleased]

### Added
- Terminal-first architecture with shared `core` and `gui` surfaces.
- Open-source baseline docs: `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`.
- GitHub automation: CI, release workflow, issue/PR templates.

### Changed
- UI simplified to prioritize workspace + sessions + terminal workflow.
- Quick actions made state-aware and safer for restored/shell sessions.
- Control plane hardened with auth token checks and stricter request validation.

### Security
- Electron renderer sandbox enabled.
- Local control server restricted to loopback with token-based authorization.
- IPC workspace write handlers hardened with path and payload validation.
