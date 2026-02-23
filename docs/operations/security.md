# Security

Forkline is local-first, but local attack surfaces still require strict controls.

## Core controls

- loopback-only API binding (`127.0.0.1`)
- token authentication on non-public routes
- browser-origin request rejection
- request rate limiting and payload size limits
- PTY session caps and PTY write-size limits
- input validation for task IDs and filesystem paths

## Electron hardening

- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true`
- denied window-open/navigation outside trusted targets
- renderer CSP

## Secret handling

- core token loaded from env or restricted local token file
- workspace env vars intentionally not persisted to disk
- query-string token patterns removed from control URLs

## CI security gates

- dependency review
- Semgrep (`auto` + custom rules)
- CodeQL
- security smoke tests

## Manual validation checklist

```bash
curl -i http://127.0.0.1:34600/v1/health
curl -i http://127.0.0.1:34600/v1/pty/sessions
TOKEN=$(cat ~/.forkline/core.token)
curl -i -H "Authorization: Bearer $TOKEN" http://127.0.0.1:34600/v1/pty/sessions
curl -i -H "Origin: https://evil.example" -H "Authorization: Bearer $TOKEN" http://127.0.0.1:34600/v1/pty/sessions
```

For vulnerability handling policy, see root `SECURITY.md`.
