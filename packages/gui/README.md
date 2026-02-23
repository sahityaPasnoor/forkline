# @forkline/gui

This package is the GUI boundary for Forkline.

Current state:
- The existing Electron + React app at repository root is the active GUI implementation.

Target state:
- GUI should consume `@forkline/core` through the shared `@forkline/protocol` API.
- No direct PTY or git orchestration logic should live in GUI.
