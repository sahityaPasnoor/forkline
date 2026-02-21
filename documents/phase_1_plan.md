# Phase 1: Foundation & UI Shell

## Objective
Establish the core Electron application with a React frontend, integrating the foundational UI layout (sidebar + main view) and setting up a basic `xterm.js` terminal window (without backend PTY wiring yet).

## Environment Setup
1. **Node.js**: Ensure Node.js (v18+ recommended) is installed.
2. **OS**: Darwin (macOS) is the primary target for initial development.
3. **Build Tools**: Because we will eventually need `node-pty` (which relies on native C++ bindings), ensure Xcode Command Line Tools are installed (`xcode-select --install`).

## Dependencies
### Development Dependencies
- `electron`: The desktop application framework.
- `vite`: Fast frontend build tool.
- `electron-vite`: Vite plugin for Electron.
- `typescript`: For type safety.
- `@types/react`, `@types/react-dom`: React types.
- `concurrently`: To run Vite and Electron simultaneously during dev.
- `wait-on`: To wait for Vite dev server before launching Electron.

### Runtime Dependencies
- `react`, `react-dom`: UI rendering.
- `xterm`, `xterm-addon-fit`: For the terminal UI component.
- `lucide-react`: For UI icons (sidebar tabs, plus button).

## Task Breakdown
1. **Project Initialization**:
   - Initialize a new `package.json`.
   - Setup a Vite + React + TypeScript frontend structure.
   - Setup an Electron backend structure (`main.ts`, `preload.ts`).
2. **Configuration**:
   - Configure `vite.config.ts` to output to the correct build directories.
   - Configure Electron to load the Vite dev server URL in development and local HTML files in production.
3. **UI Layout Implementation**:
   - Create a main `App.tsx` layout featuring a left-side navigation sidebar and a main content area.
   - The sidebar should have a "New Task" placeholder button and a list of mock vertical tabs.
4. **Terminal Component**:
   - Create a `Terminal.tsx` React component.
   - Initialize `xterm.js` and the `FitAddon` inside a `useEffect` hook, attaching it to a DOM ref.
   - Render this component in the main content area of the layout.

## Commands to Run (For Implementation)
```bash
# Initialize project
npm init -y

# Install Core dependencies
npm install react react-dom xterm xterm-addon-fit lucide-react

# Install Dev dependencies
npm install -D electron vite electron-vite typescript @types/react @types/react-dom concurrently wait-on

# Scaffold basic TS configs (will be created programmatically)
```

## Verification Steps
1. **Build Success**: Running `npm run build` should successfully compile both the React frontend and the Electron main process without type errors.
2. **App Launch**: Running `npm run dev` should open an Electron window.
3. **UI Verification**: The window should display a two-pane layout (sidebar on the left, main terminal area on the right).
4. **Terminal Render**: The main area should display a black terminal background with a cursor, powered by `xterm.js` (even if it cannot accept typing yet, it must render correctly).
5. **Console Errors**: The Developer Tools console within the Electron app should show zero errors or warnings regarding React mounting or xterm initialization.
