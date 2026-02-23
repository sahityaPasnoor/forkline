# Multi-Agent Orchestrator IDE

## Overview
The Multi-Agent Orchestrator is a desktop application built to solve the "context-switching fatigue" and "terminal sprawl" associated with managing multiple local, headless AI coding agents (such as Claude Code, Aider, Gemini CLI, Cursor, Amp, etc.) working simultaneously on large monorepos. 

Instead of juggling multiple raw terminal windows and manually managing git branches to prevent agents from colliding, this IDE acts as a **Fleet Command Center**. It abstracts away the boilerplate of Git worktree creation, context injection, and terminal multiplexing into a highly polished, zero-distraction "Stealth" user interface.

## Core Architecture
The application is built on a modern, local-first stack:
- **Framework:** Electron (Node.js backend + Chromium frontend)
- **Frontend UI:** React (TypeScript), Vite, Tailwind CSS (Custom "Stealth" high-contrast theme)
- **Terminal Engine:** `xterm.js` for the frontend viewport, connected via IPC to `node-pty` instances running the actual bash shells in the background.
- **Isolation Engine:** `simple-git` is used heavily in the backend to manage Git Worktrees, ensuring every agent operates in a physically isolated folder and branch.
- **Control Plane API:** A custom Node `http` server runs locally on port `34567` (`AgentControlServer`). It acts as an API bridge, allowing headless CLI agents to communicate back to the React UI (e.g., requesting merges, updating Todo lists).

## Key Features & Implementations

### 1. Git Worktree Isolation
When a user clicks "Spawn Agent," the IDE automatically validates the workspace, sanitizes the requested branch name, and runs `git worktree add`. This creates a temporary, isolated environment so 5 agents can refactor 5 different parts of a monorepo simultaneously without Git merge conflicts.

### 2. Auto-Discovery of Local Agents
On boot, the Electron backend scans the host machine's `PATH` to automatically detect installed AI agents (checking for `claude`, `aider`, `gemini`, `codex`, `amp`, etc.) and their specific version numbers. This populates a dropdown, saving the user from typing raw CLI commands.

### 3. Action Required Detection & Blocking Overlay
Headless agents frequently pause to ask for human confirmation (e.g., `Do you want to run this? (y/n)`). 
- The backend `ptyManager` uses a Regex stream parser to detect these blocking prompts in real-time.
- If an agent in a background tab gets stuck, the IDE immediately flashes a red warning indicator in the sidebar.
- Switching to that tab reveals a clean GUI overlay asking the user to Approve (Y) or Reject (N), abstracting the terminal interaction.

### 4. Fleet Dashboard & Collision Radar
- **Grid View:** Users can toggle away from the 1:1 terminal view to a "Fleet Dashboard" grid, monitoring the status, current task, and active branch of every agent at a glance.
- **Collision Detection:** A background loop continuously polls `git status` across all active worktrees. If it detects two different agents modifying the exact same file path, it triggers a critical UI alert to prevent impossible merge conflicts.

### 5. Quick Action Macros
To prevent typing the same prompts endlessly, the Terminal view features an "Action Dock" at the bottom. These buttons pipe highly verbose, engineered prompts directly into the agent's PTY. 
- *Example:* Clicking "Test & Fix" doesn't just run `npm test`; it injects `"Please run the test suite and fix any errors that occur."`

### 6. The IDE Capabilities API
When a worktree is created, the IDE drops an `.agent_api.md` file into the directory, documenting a local `$MULTI_AGENT_IDE_URL`.
- Agents can `POST /todos` to visually update a Kanban-style "Execution Plan" panel in the IDE.
- Agents can `POST /merge` to ask the user to review their diff and merge their worktree back into the main branch.

### 7. MCP & Context Injection
- The IDE Settings allow defining a global System Context and Model Context Protocol (MCP) server JSON.
- Upon spawning an agent, these are dynamically written into the isolated worktree as `.agent_memory.md` and `mcp.json`, seamlessly hooking the local agent into the user's internal toolchains without manual setup.

### 8. Agent Handover Protocol
If one agent (e.g., Claude) gets stuck on a complex logic error, the user can trigger a "Handover." The IDE forcefully interrupts the current agent (`SIGINT`), keeps the worktree intact, and boots up a different agent (e.g., Aider) in the exact same directory with a "Handover Prompt" to take over the task.

## Upcoming Roadmap (Planned but not implemented)
- **Session History / Memory Vault:** Saving deleted/merged task states to a local SQLite or JSON store, allowing users to "resurrect" past agent sessions, review what they did, and branch off them again.
- **Strict Docker Sandboxing:** Moving beyond Git Worktrees to mount the agents inside ephemeral Docker containers for total file system security.