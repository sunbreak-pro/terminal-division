# 002: Cmd+Backspace 後の Undo で最後の 1 文字が欠落

**Status**: Fixed
**Discovered**: 2026-02 頃
**Resolved**: 2026-02
**Related**: `src/renderer/src/App.tsx`, `src/renderer/src/services/terminalManager.ts`

---

## Symptoms

Cmd+Backspace で行を削除した後、Cmd+Z で undo すると最後の 1 文字が欠落する。

### 再現手順

1. "hello" を入力
2. Cmd+Backspace で行を削除（空になる）
3. Cmd+Z
4. **期待**: "hello" 復元
5. **実際**: "hell" が復元（最後の "o" が欠落）

### ログ

```
[onData] data: "o"
[recordHistory] undoStack after: ["","h","he","hel","hell"]
[recordHistory] currentLine after: "hello"
[undo] undoStack: ["","h","he","hel","hell"]  ← Cmd+Backspace の記録がない
[undo] currentLine: "hello"                    ← 空になっていない
[undo] returning newText: "hell"
```

---

## Root Cause

`window.api.pty.write()` は **PTY に直接書き込む**ため、xterm.js の `terminal.onData` ハンドラを**バイパス**する。その結果、`recordHistory("")` が呼ばれず Undo 履歴が破損する。

### データフロー比較

| 操作                | フロー                                                      | 履歴記録 |
| ------------------- | ----------------------------------------------------------- | -------- |
| 通常入力            | keyboard → xterm.js → terminal.onData → recordHistory → PTY | ✓        |
| Cmd+Backspace（旧） | keyboard → App.tsx → window.api.pty.write → PTY             | ✗        |

---

## Fix

`App.tsx` から直接 PTY に書き込まず、`terminalManager` 経由で履歴記録を行ってから PTY に制御シーケンスを送る。

### 1. `terminalManager.ts` に `clearLine()` を追加

```typescript
export function clearLine(
  id: string,
): { moveToEnd: string; clearCmd: string } | null {
  const instance = registry.get(id);
  if (!instance) return null;
  const { inputHistory } = instance;

  if (inputHistory.currentLine !== "") {
    inputHistory.redoStack = [];
    inputHistory.undoStack.push(inputHistory.currentLine);
    if (inputHistory.undoStack.length > MAX_UNDO_STACK_SIZE) {
      inputHistory.undoStack.shift();
    }
    inputHistory.currentLine = "";
  }

  return {
    moveToEnd: "\x05", // Ctrl+E: 行末へ
    clearCmd: "\x15", // Ctrl+U: 行頭まで削除
  };
}
```

### 2. `App.tsx` の Cmd+Backspace 処理

```typescript
if (isMeta && !isShift && !isOption && e.key === "Backspace") {
  e.preventDefault();
  e.stopPropagation();
  if (activeTerminalId) {
    const result = terminalManager.clearLine(activeTerminalId);
    if (result) {
      window.api.pty.write(activeTerminalId, result.moveToEnd);
      window.api.pty.write(activeTerminalId, result.clearCmd);
    }
  }
  return;
}
```

### 修正後のフロー

```
Cmd+Backspace
  → App.tsx
  → terminalManager.clearLine (履歴記録)
  → window.api.pty.write
  → PTY
```

---

## Lessons Learned

- **`window.api.pty.write()` は xterm.js の `onData` をバイパスする**。履歴管理が必要な操作は必ず `terminalManager` を経由する
- **ショートカットで PTY を直接操作する場合、通常入力とデータフローが異なることを意識する**
- レビュー観点: 新規ショートカットが PTY に制御シーケンスを送るとき、「履歴管理が必要か」を確認する
- 同種リスク: `\x17`（Ctrl+W 単語削除）や `\x0b`（Ctrl+K カーソル以降削除）を直接送るショートカットも同じ罠を持つ。現状は `recordHistory()` 側が制御文字を解釈して履歴を更新しているが、将来追加するショートカットでも同じ配慮が必要

## References

- 関連ファイル: `src/renderer/src/services/terminalManager.ts`（`clearLine()`）, `src/renderer/src/App.tsx`（Cmd+Backspace ハンドラ）
- 関連解説: `docs/code-explanation/05-advanced-features.md` の「Undo/Redo」章
