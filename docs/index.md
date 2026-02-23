---
layout: home

hero:
  name: "Forkline"
  text: "Open-source control plane for local multi-agent coding"
  tagline: "Run many coding agents in parallel with isolated Git worktrees, persistent PTY sessions, and operator approvals."
  image:
    src: /logo.svg
    alt: Forkline logo
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Explore API
      link: /reference/core-api

features:
  - title: Worktree-native orchestration
    details: Every task can run in a dedicated worktree and branch, reducing branch collisions and keeping merges explicit.
  - title: Persistent PTY lifecycle
    details: Forkline keeps PTY state and output buffers so operators can reattach without losing terminal context.
  - title: Token-auth local APIs
    details: Core and GUI control servers enforce token auth, loopback-only networking, and browser-origin rejection.
  - title: Fleet observability
    details: Track task state, blocked prompts, usage, and quick actions across active sessions.
  - title: Model-agnostic workflow
    details: Forkline orchestrates agent CLIs instead of replacing them, with policy controls layered on top.
  - title: Open-source release discipline
    details: Security checks, SBOM generation, provenance, and attestation are wired into CI and release workflows.
---

## What you will find here

- Operator docs for setup, daily workflow, and troubleshooting.
- Architecture docs for `core`, `protocol`, `tui`, `electron`, and renderer boundaries.
- API reference for daemon routes, SSE event envelopes, quick actions, and environment variables.
- Security and release playbooks aligned with open-source standards.
- Documentation style guide for contributors.

## Product scope

Forkline has three runtime tiers:

- `core` (`stable`): headless daemon with PTY and Git orchestration.
- `gui` (`stable`): Electron + React command center.
- `tui` (`experimental`): terminal client over the core API.

## Source of truth

These docs are derived from the implementation in:

- `packages/core/src/daemon.js`
- `packages/core/src/services/*`
- `packages/protocol/src/*`
- `packages/tui/src/index.js`
- `electron/agentServer.ts`

For architecture and policy detail, see `documents/` and root open-source governance files.
