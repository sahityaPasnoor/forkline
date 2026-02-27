# ~/.forkline export (sanitized)

Original local path: `~/.forkline/`

This export intentionally excludes `core.token` because it is a live local auth secret.

To recreate locally:
1. Start core once (`forkline-core` or `npm run core:start`) to auto-generate token file.
2. Or set `FORKLINE_CORE_TOKEN` and `FORKLINE_CORE_TOKEN_FILE` explicitly.
