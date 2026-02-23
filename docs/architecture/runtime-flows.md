# Runtime Flows

## Core daemon request handling

```mermaid
flowchart TD
  A["Incoming request"] --> B{"Loopback remote?"}
  B -- no --> X["403 Forbidden"]
  B -- yes --> C{"Origin header present?"}
  C -- yes --> Y["403 Cross-origin denied"]
  C -- no --> D{"Rate limit exceeded?"}
  D -- yes --> Z["429"]
  D -- no --> E{"Public route?"}
  E -- yes --> F["Health/Version"]
  E -- no --> G{"Valid auth token?"}
  G -- no --> U["403 Unauthorized"]
  G -- yes --> H["Route-specific validation"]
  H --> I["Git/PTy service execution"]
  I --> J["JSON response"]
```

## PTY lifecycle

```mermaid
stateDiagram-v2
  [*] --> Created: createSession(taskId)
  Created --> Running: spawn shell
  Running --> Blocked: regex prompt detection
  Blocked --> Running: write/resume
  Running --> Exited: process exit
  Exited --> Running: attach + restart
  Running --> Destroyed: destroy
  Exited --> Destroyed: destroy
```

## Worktree lifecycle

1. Validate source path and Git state.
2. Ensure initial commit exists.
3. Compute safe task branch and target worktree path.
4. Reuse existing worktree if already present.
5. Create branch/worktree from requested base branch when available.
6. Merge/remove workflow cleans worktree and branch.

## Event stream model

Core emits SSE envelopes:

```json
{
  "id": "1700000000000-ab12cd",
  "ts": 1700000000000,
  "type": "pty.data",
  "payload": {
    "taskId": "task-1",
    "data": "..."
  }
}
```
