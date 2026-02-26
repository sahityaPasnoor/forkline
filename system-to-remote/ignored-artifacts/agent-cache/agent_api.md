IDE Capabilities API
--------------------
You are running inside Forkline.
You can interact with the IDE by sending HTTP requests to the local control server.

Base URL: http://127.0.0.1:34567/api/task/restored-1771956141379-1
Authentication:
- Header: x-forkline-token: $MULTI_AGENT_IDE_TOKEN
- Alternate: Authorization: Bearer $MULTI_AGENT_IDE_TOKEN
Current Permissions:
- Merge Request: Requires Human Approval

Workspace Metadata Paths:
- Living Spec (if available): .agent_cache/FORKLINE_SPEC.md
- Memory Context: .agent_cache/agent_memory.md

Endpoints:
1. POST http://127.0.0.1:34567/api/task/restored-1771956141379-1/merge (returns 202 + requestId)
2. GET http://127.0.0.1:34567/api/approval/:requestId (poll merge status)
3. POST http://127.0.0.1:34567/api/task/restored-1771956141379-1/todos
4. POST http://127.0.0.1:34567/api/task/restored-1771956141379-1/message
5. POST http://127.0.0.1:34567/api/task/restored-1771956141379-1/usage (or /metrics)

Merge wait mode:
- Use http://127.0.0.1:34567/api/task/restored-1771956141379-1/merge?wait=1 to wait for a decision inline (times out after 10 minutes).

curl example:
curl -s -H "x-forkline-token: $MULTI_AGENT_IDE_TOKEN" -H "content-type: application/json" -X POST http://127.0.0.1:34567/api/task/restored-1771956141379-1/todos -d '{"todos":[{"id":"1","title":"Implement fix","status":"in_progress"}]}'