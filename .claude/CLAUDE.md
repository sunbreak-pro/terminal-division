# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Terminal Division is a macOS terminal splitting application built with Electron + React + TypeScript. It provides iTerm2-style pane splitting with xterm.js terminals backed by node-pty.

## Development Commands

```bash
npm run dev        # Start development mode (electron-vite dev, hot reload)
npm run build      # Production build (electron-vite build)
npm run preview    # Preview production build
```

No test runner is configured.

## Architecture

### Three-Process Model (Electron)

- **Main process** (`src/main/`): Window lifecycle, PTY spawning, IPC handlers
- **Preload** (`src/preload/`): Context bridge exposing `window.api.pty.*` to renderer
- **Renderer** (`src/renderer/`): React UI with xterm.js terminals

### Layout System

The layout is a **binary tree** stored in a Zustand store (`terminalStore.ts`):
- `TerminalPane` = leaf node (a terminal)
- `SplitNode` = internal node with `direction` (horizontal/vertical) and two children
- All nodes stored in a flat `Map<string, LayoutNode>` with `parentId` references
- `rootId` tracks the tree root; max 6 terminals (`MAX_TERMINALS`)
- `react-resizable-panels` handles the visual split rendering in `SplitContainer.tsx`

### Terminal Lifecycle

1. `terminalStore.splitTerminal()` creates the tree node
2. `TerminalPane.tsx` mounts → calls `terminalManager.getOrCreate()` to create xterm.js instance + register listeners (once per terminal, independent of React lifecycle)
3. `terminalManager.attachToContainer()` opens xterm in the DOM
4. IPC `pty:create` spawns a `node-pty` process in main
5. Data flows: xterm.onData → IPC `pty:write` → node-pty → IPC `pty:data` → xterm.write

### Undo/Redo System (`terminalManager.ts`)

Per-terminal input history with `undoStack`/`redoStack`/`currentLine`. Key complexity:
- PTY echo-back prevention: `undoRedoInProgress` flag + `pendingSentText` tracking prevent the PTY's echo from being recorded as new input
- 300ms debounced flag reset for packaged app latency
- Timer cancellation on consecutive undo/redo operations
- History resets on Enter (line commit)

### IME Composition Handling (`terminalManager.ts`)

Critical for Japanese/CJK input:
- `compositionstart`/`compositionend` events on xterm's textarea
- Non-ASCII characters during composition are handled only via `compositionend` to prevent double-send
- `lastCompositionData` deduplication against xterm.js's `setTimeout(0)` dispatch

### Keyboard Shortcuts (`App.tsx`)

Registered on `window` in capture phase (before xterm processes keys). Shortcuts send control sequences directly to PTY via `window.api.pty.write()`:
- `Cmd+D` / `Cmd+Shift+D`: Split vertical/horizontal
- `Cmd+W`: Close pane
- `Cmd+Z` / `Cmd+Shift+Z`: Undo/redo input
- `Cmd+Backspace`: Clear line (with history)
- `Cmd+Option+Arrow`: Focus navigation between panes
- `Option+Arrow`: Word navigation (`ESC+b`/`ESC+f`)

### PTY Manager (`pty-manager.ts`)

- Spawns shell from `$SHELL` (fallback `/bin/zsh`) with Japanese locale (`LANG=ja_JP.UTF-8`)
- Filters `npm_*` environment variables for nvm compatibility
- Large pastes (>512 bytes) use chunked writing with bracket paste mode

## Key Conventions

- Code comments are in Japanese
- Path alias: `@` → `src/renderer/` (configured in `electron.vite.config.ts`)
- `node-pty` is marked as external in Vite config (native module)
- `terminalManager` is a module-scoped registry (not React state) to survive re-renders

## Task Tracking

- `.claude/TODO.md`: Priority-based task list (P0-P3)
- `.claude/bugs/`: Active bug reports
- `.claude/solutions/`: Documented fixes for reference
- `.claude/specs/`: Feature specs and design decisions
