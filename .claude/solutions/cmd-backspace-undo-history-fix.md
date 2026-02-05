# Cmd+Backspace後のUndo履歴バグ修正

## バグ概要

**症状**: Cmd+Backspaceで行を削除した後、Cmd+Zでundoすると最後の1文字が欠落する

### 再現手順
1. "hello" を入力
2. Cmd+Backspace で行を削除（空になる）
3. Cmd+Z を押す
4. **期待**: "hello" が復元される
5. **実際**: "hell" が復元される（最後の "o" が欠落）

---

## 根本原因

### 問題のあったコード（App.tsx 113-123行目）

```typescript
// Cmd + Delete: 行全体を削除
if (isMeta && !isShift && !isOption && e.key === "Backspace") {
  e.preventDefault();
  e.stopPropagation();
  if (activeTerminalId) {
    window.api.pty.write(activeTerminalId, "\x05"); // Ctrl+E: 行末へ
    window.api.pty.write(activeTerminalId, "\x15"); // Ctrl+U: 行頭まで削除
  }
  return;
}
```

### 問題点

`window.api.pty.write()` は **PTYに直接書き込む** ため、`terminal.onData` ハンドラを**バイパス**する。その結果、`recordHistory("")` が**呼ばれない**。

### データフロー比較

| 操作 | フロー | 履歴記録 |
|------|--------|----------|
| 通常入力 | keyboard → xterm.js → terminal.onData → recordHistory → PTY | ✓ |
| Cmd+Backspace | keyboard → App.tsx → window.api.pty.write → PTY | ✗ |

### ログ分析

```
[onData] ... data: "o"
[recordHistory] newLine: "hello"
[recordHistory] undoStack after: ["","h","he","hel","hell"]
[recordHistory] currentLine after: "hello"
[onData] SENT
[undo] undoStack: ["","h","he","hel","hell"]  ← Cmd+Backspaceの記録がない！
[undo] currentLine: "hello"                    ← 空になっていない！
[undo] returning newText: "hell"
```

Cmd+Backspace後も `undoStack` に `"hello"` が追加されておらず、`currentLine` も `""` に更新されていない。

---

## 解決方法

### 方針

App.tsxから直接PTYに書き込むのではなく、terminalManagerを経由して履歴も同時に記録する。

### 修正1: terminalManager.ts に `clearLine()` 関数を追加

```typescript
/**
 * 行全体をクリア（Cmd+Backspace用）
 * 履歴に記録してからPTYにクリアコマンドを返す
 */
export function clearLine(id: string): { moveToEnd: string; clearCmd: string } | null {
  const instance = registry.get(id)
  if (!instance) return null

  const { inputHistory } = instance

  // 現在の行が空でない場合のみ履歴に記録
  if (inputHistory.currentLine !== '') {
    // redoスタックをクリア（新しい操作が行われたため）
    inputHistory.redoStack = []
    // 現在の状態をundoスタックに保存
    inputHistory.undoStack.push(inputHistory.currentLine)
    // スタックサイズを制限
    if (inputHistory.undoStack.length > MAX_UNDO_STACK_SIZE) {
      inputHistory.undoStack.shift()
    }
    // 行内容を空にする
    inputHistory.currentLine = ''
  }

  return {
    moveToEnd: '\x05', // Ctrl+E: 行末へ
    clearCmd: '\x15'   // Ctrl+U: 行頭まで削除
  }
}
```

### 修正2: App.tsx の Cmd+Backspace 処理を修正

```typescript
// Cmd + Delete: 行全体を削除
if (isMeta && !isShift && !isOption && e.key === "Backspace") {
  e.preventDefault();
  e.stopPropagation();
  if (activeTerminalId) {
    // terminalManagerを経由して履歴に記録してからクリア
    const result = terminalManager.clearLine(activeTerminalId);
    if (result) {
      window.api.pty.write(activeTerminalId, result.moveToEnd);
      window.api.pty.write(activeTerminalId, result.clearCmd);
    }
  }
  return;
}
```

---

## 修正後のデータフロー

```
修正前: Cmd+Backspace → App.tsx → window.api.pty.write → PTY (履歴記録なし!)

修正後: Cmd+Backspace → App.tsx → terminalManager.clearLine (履歴記録) → window.api.pty.write → PTY
```

---

## 対象ファイル

- `src/renderer/src/services/terminalManager.ts` - `clearLine()` 関数を追加
- `src/renderer/src/App.tsx` - Cmd+Backspace の処理を修正

---

## 検証シナリオ

1. **基本シナリオ**:
   - "hello" 入力 → Cmd+Backspace → Cmd+Z
   - **期待**: "hello" が復元される ✓

2. **連続操作**:
   - "hello" 入力 → Cmd+Z → Cmd+Backspace → Cmd+Z
   - **期待**: "hell" が復元される

3. **日本語混在**:
   - "hello" → Cmd+Backspace → 「こんにちは」 → Cmd+Backspace → Cmd+Z
   - **期待**: 「こんにちは」が復元される

---

## 学んだこと

- `window.api.pty.write()` でPTYに直接書き込むと、xterm.jsの `terminal.onData` ハンドラをバイパスする
- 履歴管理が必要な操作は、必ず履歴管理モジュール（terminalManager）を経由するべき
- ショートカットキーでPTY操作を行う場合、通常入力とは異なるデータフローになることを意識する
