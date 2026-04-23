# 高度な機能

> **前提知識**: [02-electron-basics.md](./02-electron-basics.md) / [03-data-flow.md](./03-data-flow.md) / [04-layout-and-state.md](./04-layout-and-state.md)
>
> **関連ドキュメント**: [01-architecture-overview.md](./01-architecture-overview.md)

本ドキュメントでは、Terminal Divisionの中で特に実装が複雑な2つの機能を解説します:

1. **IME（日本語入力）** — xterm.jsとIMEコンポジションの競合解決
2. **ショートカットキー** — キャプチャフェーズによるキー横取り

---

## IME（日本語入力）

### 問題の背景

xterm.jsは元々ASCII入力向けに設計されており、IME（Input Method Editor）によるコンポジション入力と相性が悪い点があります。

**具体的な問題:**

1. IMEコンポジション中に、xterm.jsの`onData`が非ASCII文字を中間状態で送信してしまう
2. `compositionend`で確定したテキストを送信した後、xterm.jsが`setTimeout(0)`で同じテキストを再送信する（二重送信）

### IMEイベントフロー

日本語で「日本」と入力する場合のイベントフローです:

```mermaid
sequenceDiagram
    actor User as ユーザー
    participant IME as macOS IME
    participant TA as textarea<br/>(xterm内部)
    participant XT as xterm.js<br/>onData
    participant TM as terminalManager
    participant PTY as PTY

    User->>IME: "n", "i", "h", "o", "n" キー入力
    IME->>TA: compositionstart
    Note over TM: isComposing = true

    IME->>TA: compositionupdate ("に")
    IME->>TA: compositionupdate ("にほ")
    IME->>TA: compositionupdate ("にほん")

    Note over XT: onData("にほん") が発火するが...
    XT->>TM: onData("にほん")
    Note over TM: isComposing && 非ASCII → SKIP

    User->>IME: Enter（確定）
    IME->>TA: compositionend ("にほん")
    Note over TM: isComposing = false<br/>lastCompositionData = "にほん"
    TM->>PTY: callbacks.onData("にほん") → pty:write

    Note over XT: setTimeout(0)後に onData("にほん") が再発火
    XT->>TM: onData("にほん")
    Note over TM: data === lastCompositionData → SKIP<br/>(二重送信防止)
```

### 実装の詳細

**1. Compositionイベントリスナー** (`src/renderer/services/terminalManager.ts:200-230`)

xterm.js内部の`<textarea>`要素にcompositionイベントリスナーを直接追加します:

```typescript
textarea.addEventListener("compositionstart", () => {
  isComposing = true;
  lastCompositionData = null;
});

textarea.addEventListener("compositionend", (e: CompositionEvent) => {
  isComposing = false;
  if (e.data && e.data.length > 0) {
    lastCompositionData = e.data; // 二重送信防止用に記録
    callbacks.onData(e.data); // PTYに送信
  }
});
```

**2. onData内のフィルタリング** (`src/renderer/services/terminalManager.ts:142-153`)

```typescript
terminal.onData((data) => {
  // コンポジション中の非ASCII文字をスキップ（中間状態の誤送信を防止）
  if (isComposing && /[^\x00-\x7F]/.test(data)) {
    return; // SKIP
  }

  // compositionendで送信済みのデータと重複する場合スキップ
  if (lastCompositionData !== null && data === lastCompositionData) {
    lastCompositionData = null;
    return; // SKIP
  }
  lastCompositionData = null;

  // 通常処理...
});
```

> **Note:** `isComposing`チェックで**非ASCII文字のみ**をスキップしている理由は、IMEコンポジション中でも矢印キーやBackspace（ASCII制御文字）は処理する必要があるためです。

**3. 登録タイミング** (`src/renderer/services/terminalManager.ts:328-335`)

compositionリスナーは`attachToContainer()`の中で、DOMにアタッチされた後に一度だけ登録されます:

```typescript
if (!instance.compositionRegistered) {
  registerCompositionListeners();
  instance.compositionRegistered = true;
}
```

---

## ショートカットキー

### キャプチャフェーズの仕組み

xterm.jsは`<textarea>`でキーイベントを処理します。ショートカットキーをxterm.jsより先に処理するため、`window`レベルで**キャプチャフェーズ**のリスナーを登録しています。

```
DOMイベントの伝播順序:

  キャプチャフェーズ（上→下）     バブリングフェーズ（下→上）
  ┌──────────┐                ┌──────────┐
  │ window    │ ← ここで処理   │ window   │
  ├──────────┤                ├──────────┤
  │ document  │                │ document │
  ├──────────┤                ├──────────┤
  │ div#root  │                │ div#root │
  ├──────────┤                ├──────────┤
  │ textarea  │ ← xterm.jsの   │ textarea │
  └──────────┘   リスナーはここ  └──────────┘
```

```typescript
// src/renderer/App.tsx:264
window.addEventListener("keydown", handleKeyDown, true);
//                                                ^^^^ true = キャプチャフェーズ
```

ショートカットに該当するキーは`e.preventDefault()` + `e.stopPropagation()`でxterm.jsへの到達を阻止します。

### IMEコンポジション中のスキップ

ショートカットハンドラーの先頭で、IME変換中かどうかを判定しています:

```typescript
// src/renderer/App.tsx:51-53
if (e.isComposing || e.keyCode === 229) {
  return; // IME変換中はショートカットを処理しない
}
```

> **Note:** `keyCode === 229`は、ブラウザがIMEコンポジション中のキー入力に対して設定する特別な値です。`isComposing`と併用することで確実にIME中を検出します。

### ショートカット一覧

| キー               | 動作                         | 制御シーケンス  | 実装箇所      |
| ------------------ | ---------------------------- | --------------- | ------------- |
| `Cmd+D`            | 縦分割（horizontal）         | —               | `App.tsx:60`  |
| `Cmd+Shift+D`      | 横分割（vertical）           | —               | `App.tsx:69`  |
| `Cmd+W`            | ペインを閉じる               | —               | `App.tsx:105` |
| `Cmd+Backspace`    | カーソル位置から行頭まで削除 | `\x15`          | `App.tsx:122` |
| `Cmd+K`            | カーソル以降を削除           | `\x0b`          | `App.tsx:129` |
| `Cmd+←`            | 行の先頭へ                   | `\x01` (Ctrl+A) | `App.tsx:171` |
| `Cmd+→`            | 行の末尾へ                   | `\x05` (Ctrl+E) | `App.tsx:180` |
| `Cmd+Shift+Arrow`  | 現在行を選択                 | —               | `App.tsx:78`  |
| `Cmd+Shift+A`      | 現在行を選択                 | —               | `App.tsx:95`  |
| `Option+←`         | 単語単位で左移動             | `\x1bb` (ESC+b) | `App.tsx:211` |
| `Option+→`         | 単語単位で右移動             | `\x1bf` (ESC+f) | `App.tsx:220` |
| `Option+Backspace` | 単語を後方削除               | `\x17` (Ctrl+W) | `App.tsx:201` |
| `Option+D`         | 単語を前方削除               | `\x1bd` (ESC+d) | `App.tsx:231` |
| `Shift+Enter`      | 改行を挿入                   | `\n`            | `App.tsx:191` |
| `Cmd+Option+Arrow` | フォーカス移動               | —               | `App.tsx:241` |

### フォーカス移動のロジック

`Cmd+Option+矢印`でペイン間をフォーカス移動します。`moveFocus()`は`getAllTerminalIds()`で取得したID配列を循環的にナビゲートします:

```typescript
// src/renderer/App.tsx:27-46
const moveFocus = useCallback(
  (direction: "up" | "down" | "left" | "right") => {
    const currentIndex = terminalIds.indexOf(activeTerminalId);
    let nextIndex: number;
    if (direction === "left" || direction === "up") {
      nextIndex = currentIndex > 0 ? currentIndex - 1 : terminalIds.length - 1;
    } else {
      nextIndex = currentIndex < terminalIds.length - 1 ? currentIndex + 1 : 0;
    }
    setActiveTerminal(terminalIds[nextIndex]);
  },
  [terminalIds, activeTerminalId, setActiveTerminal],
);
```

> **Note:** 現在の実装は空間的な位置関係ではなく、ID配列の順序に基づく単純な循環です。left/upで前のIDへ、right/downで次のIDへ移動します。

---

## terminalManagerのライフサイクル

`terminalManager`はReactの外部（モジュールスコープ）で管理されるxterm.jsインスタンスのレジストリです。

### なぜモジュールスコープなのか

React StrictModeやコンポーネントの再レンダリングによって、`useEffect`のクリーンアップと再実行が発生します。xterm.jsインスタンスやIPCリスナーをReactの状態として管理すると、再レンダリングのたびに破棄と再作成が繰り返されてしまいます。

モジュールスコープの`Map`に格納することで:

- Reactのライフサイクルに依存しない安定した参照
- `getOrCreate()`パターンで重複作成を防止
- リスナーの多重登録を確実に回避

```typescript
// src/renderer/services/terminalManager.ts:26
const registry = new Map<string, TerminalInstance>();
```

### getOrCreateパターン

```typescript
// src/renderer/services/terminalManager.ts:48-57
export function getOrCreate(id, options, callbacks): TerminalInstance {
  const existing = registry.get(id);
  if (existing) {
    return existing; // 既存インスタンスを返す（リスナー再登録なし）
  }
  // 新規作成: Terminal + FitAddon + リスナー登録
  // ...
  registry.set(id, instance);
  return instance;
}
```

### TerminalInstance構造

```typescript
// src/renderer/services/terminalManager.ts:15-23
export interface TerminalInstance {
  terminal: Terminal; // xterm.jsインスタンス
  fitAddon: FitAddon; // サイズ自動調整アドオン
  ptyCreated: boolean; // PTYが生成済みかどうか
  compositionRegistered: boolean; // IMEリスナーが登録済みか
  dataListenerRemover: (() => void) | null; // データリスナーの解除関数
  exitListenerRemover: (() => void) | null; // 終了リスナーの解除関数
}
```

### クリーンアップ

`destroy()`は以下の順序でリソースを解放します（`src/renderer/services/terminalManager.ts:277-303`）:

1. IPCリスナー解除 (`dataListenerRemover`, `exitListenerRemover`)
2. xterm.js dispose (`terminal.dispose()`)
3. Registryから削除 (`registry.delete(id)`)

> **Note:** TerminalPaneコンポーネントのクリーンアップ（`useEffect`の返り値）では`destroy()`を**呼びません**。ResizeObserverの切断と`detachFromContainer()`のみを行います。`destroy()`は`closeTerminal()`（Zustandストア）からのみ呼ばれます。これにより、React StrictModeの二重実行でターミナルが破棄されることを防いでいます。

---

## まとめ

| 機能            | 核心的な課題                         | 解決策                                   |
| --------------- | ------------------------------------ | ---------------------------------------- |
| IME入力         | xterm.jsとの二重送信・中間状態の漏洩 | compositionイベント直接処理 + dedup      |
| ショートカット  | xterm.jsがキーを横取りする           | キャプチャフェーズでの先行処理           |
| terminalManager | Reactライフサイクルとの分離          | モジュールスコープ + getOrCreateパターン |
