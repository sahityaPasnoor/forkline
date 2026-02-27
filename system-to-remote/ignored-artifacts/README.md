# Ignored Artifacts Export

This folder contains ignored artifacts moved into a tracked location for remote sharing.

Included from ignored paths:
- `dist/`
- `docs/.vitepress/dist/`
- `docs/.vitepress/cache/`
- `test-results/`
- `.agent_cache/`
- `forkline-1.0.0.tgz`
- `forkline-core-0.1.0.tgz`
- `forkline-protocol-0.1.0.tgz`

Not included:
- `node_modules/` (very large dependency cache; includes binaries above GitHub file-size limits)
- `release/` (contains installer/bundle binaries above GitHub file-size limits)
- `.claude/` and `documents/private/` (private/local data)
