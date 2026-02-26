# Security Policy

## Supported Versions

Forkline security fixes are applied to the latest commit on `main`.

For package releases, only the latest published version is guaranteed to receive security fixes.

## Reporting a Vulnerability

Do not open public issues for vulnerabilities.

Use GitHub private advisory reporting:
- https://github.com/sahityaPasnoor/forkline/security/advisories/new

Include:
- clear impact summary
- affected component (`core`, `gui`, `protocol`)
- reproduction steps / PoC
- expected vs actual behavior
- suggested remediation if available

## Response Targets

- Initial acknowledgment: within 7 days
- Triage and severity assignment: as soon as reproducible
- Patch timeline: based on severity and exploitability

## Disclosure Process

Forkline follows coordinated disclosure.

- We will validate and triage first.
- We will prepare a fix and release notes.
- Public disclosure should follow fix availability (or documented mitigation when fix is delayed).

## Security Baseline

Forkline’s current baseline includes:
- token auth for sensitive local HTTP endpoints
- loopback-only network bindings
- browser-origin rejection on local control surfaces
- CSP for renderer
- Electron sandbox/context isolation/webSecurity
- payload/rate/session limits for daemon abuse resistance
- automated CI security gates (Dependency Review, Semgrep with repo custom rules, CodeQL, security smoke tests)
- release supply-chain checks (pinned GitHub Actions, SBOM generation, npm provenance + attestation)

See threat model details in `documents/threat-model.md`.

## Hardening Recommendations for Users

- Run Forkline on trusted developer machines only.
- Keep OS and Node.js patched.
- Avoid running untrusted prompts on sensitive repositories.
- Rotate local tokens if machine compromise is suspected.
- Keep secrets out of committed files and prompts where possible.

## Out of Scope

The following are generally out of scope unless they cross into exploitable defects:
- social engineering against users
- vulnerabilities requiring physical device compromise only
- unsupported legacy versions
