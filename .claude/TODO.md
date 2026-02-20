# TODO List

## Format

- **Priority**: P0 (Critical) | P1 (High) | P2 (Medium) | P3 (Low)
- **Category**: feature | bugfix | refactor | docs | test | chore
- **Status**: [ ] pending | [~] in-progress | [x] completed

---

## Active Tasks

### P0 - Critical
(No critical tasks)

### P1 - High
- [ ] [feature] マルチウィンドウ対応（複数ウィンドウの同時起動）
  - 各ウィンドウは独立したペインツリー・シェルセッションを持つ（設定のみ共有）
  - ウィンドウの最大数: 3
  - 各ウィンドウ内のペイン上限は既存の6を維持
  - ウィンドウの開き方:
    - Dock右クリックメニュー「新しいウィンドウ」
    - メニューバー「ファイル > 新しいウィンドウ」
    - キーボードショートカット（Cmd+N）
  - 終了挙動: 最後のウィンドウを閉じるとアプリも終了する（即終了）

### P2 - Medium
(No medium priority tasks)

### P3 - Low
(No low priority tasks)

---

## Completed Tasks

- [x] [refactor] Restructure .claude/ directory (2025-02-06)
- [x] [refactor] Flatten src/renderer/src/ nesting (2025-02-06)
- [x] [test] Set up Vitest test framework (2025-02-06)
- [x] [test] Add unit tests for terminalStore (2025-02-06)
- [x] [test] Add unit tests for terminalManager (2025-02-06)
- [x] [test] Add unit tests for pty-manager (2025-02-06)
- [x] [test] Add unit tests for themeStore (2025-02-06)
- [x] [feature] Add custom theme support (Dark, Light, Dracula, One Dark) (2025-02-06)
- [x] [perf] Improve terminal resize performance (rAF-based debounce, size caching) (2025-02-06)
- [x] [test] Add component tests (Header, TerminalPane, SplitContainer, ShortcutsModal) (2025-02-06)

---

## Backlog

Ideas and tasks without assigned priority:

(No backlog items)
