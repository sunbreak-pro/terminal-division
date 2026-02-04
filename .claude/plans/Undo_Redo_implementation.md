Here is Claude's plan:                                                                                                              

 Terminal Division アプリ側Undo/Redo実装計画                                                                                         
                                                                           
 概要

 シェル非依存のundo/redo機能をアプリ側で実装する。xterm.jsの入力を追跡し、独自の履歴スタックで管理する。

 ---
 実装方針

 基本アイデア

 1. ユーザーの入力をonDataイベントで捕捉・記録
 2. Cmd+Z/Cmd+Shift+Zで入力履歴を巻き戻し/やり直し
 3. PTYに「前の状態に戻す」コマンドを送信して行を修正

 入力フロー

 xterm.js keyboard → terminalManager.ts onData → PTY送信
                          ↓
                     履歴スタックに記録

 ---
 Phase 1: 履歴スタックの追加

 ファイル: src/renderer/src/services/terminalManager.ts

 TerminalInstanceインターフェースを拡張：

 export interface TerminalInstance {
   terminal: Terminal
   fitAddon: FitAddon
   ptyCreated: boolean
   compositionRegistered: boolean
   dataListenerRemover: (() => void) | null
   exitListenerRemover: (() => void) | null
   // 新規追加
   inputHistory: InputHistoryState
 }

 interface InputHistoryState {
   undoStack: string[]      // 過去の入力履歴
   redoStack: string[]      // undoした入力
   currentLine: string      // 現在の行内容
 }

 初期化（getOrCreate関数内）：

 const instance: TerminalInstance = {
   terminal,
   fitAddon,
   ptyCreated: false,
   compositionRegistered: false,
   // ...
   inputHistory: {
     undoStack: [],
     redoStack: [],
     currentLine: ''
   }
 }

 ---
 Phase 2: 入力履歴の記録

 ファイル: src/renderer/src/services/terminalManager.ts

 onDataイベント内で履歴を記録（行48-75付近）：

 const terminalDataDisposable = terminal.onData((data) => {
   // ... 既存のIMEフィルタリング処理 ...

   // Enterキー（\r）で行確定 → 履歴をリセット
   if (data === '\r' || data === '\n') {
     instance.inputHistory.undoStack = []
     instance.inputHistory.redoStack = []
     instance.inputHistory.currentLine = ''
     callbacks.onData(data)
     return
   }

   // 通常入力: 履歴を記録
   if (data.length > 0 && !isControlChar(data)) {
     // 新しい入力があったらredoスタックをクリア
     instance.inputHistory.redoStack = []
     // 現在の状態をundoスタックに保存
     instance.inputHistory.undoStack.push(instance.inputHistory.currentLine)
     // 行内容を更新
     instance.inputHistory.currentLine += data
   }

   // Backspace処理
   if (data === '\x7f' || data === '\b') {
     instance.inputHistory.redoStack = []
     instance.inputHistory.undoStack.push(instance.inputHistory.currentLine)
     instance.inputHistory.currentLine = instance.inputHistory.currentLine.slice(0, -1)
   }

   callbacks.onData(data)
 })

 // ヘルパー関数
 function isControlChar(data: string): boolean {
   return data.length === 1 && data.charCodeAt(0) < 32
 }

 ---
 Phase 3: Undo/Redo API

 ファイル: src/renderer/src/services/terminalManager.ts

 新規関数を追加：

 /**
  * Undo操作を実行
  * @returns 行をクリアして再入力するためのコマンド文字列、またはnull
  */
 export function undo(id: string): { clearCmd: string, newText: string } | null {
   const instance = registry.get(id)
   if (!instance) return null

   const { inputHistory } = instance
   if (inputHistory.undoStack.length === 0) return null

   // 現在の状態をredoスタックに保存
   inputHistory.redoStack.push(inputHistory.currentLine)

   // undoスタックから前の状態を復元
   const previousState = inputHistory.undoStack.pop()!
   inputHistory.currentLine = previousState

   return {
     clearCmd: '\x15',  // Ctrl+U: 行全体をクリア
     newText: previousState
   }
 }

 /**
  * Redo操作を実行
  */
 export function redo(id: string): { clearCmd: string, newText: string } | null {
   const instance = registry.get(id)
   if (!instance) return null

   const { inputHistory } = instance
   if (inputHistory.redoStack.length === 0) return null

   // 現在の状態をundoスタックに保存
   inputHistory.undoStack.push(inputHistory.currentLine)

   // redoスタックから復元
   const nextState = inputHistory.redoStack.pop()!
   inputHistory.currentLine = nextState

   return {
     clearCmd: '\x15',
     newText: nextState
   }
 }

 /**
  * 行確定時に履歴をリセット（Enter押下時）
  */
 export function resetInputHistory(id: string): void {
   const instance = registry.get(id)
   if (!instance) return

   instance.inputHistory = {
     undoStack: [],
     redoStack: [],
     currentLine: ''
   }
 }

 ---
 Phase 4: キーボードショートカットの修正

 ファイル: src/renderer/src/App.tsx

 Cmd+Z (undo) の修正（行134-144）：

 // Cmd + Z: Undo
 if (isMeta && !isShift && !isOption && e.key === "z") {
   e.preventDefault()
   e.stopPropagation()
   if (activeTerminalId) {
     const result = terminalManager.undo(activeTerminalId)
     if (result) {
       // 行をクリアして前の状態を再入力
       window.api.pty.write(activeTerminalId, result.clearCmd)
       window.api.pty.write(activeTerminalId, result.newText)
     }
   }
   return
 }

 Cmd+Shift+Z (redo) の修正（行146-156）：

 // Cmd + Shift + Z: Redo
 if (isMeta && isShift && !isOption && e.key.toLowerCase() === "z") {
   e.preventDefault()
   e.stopPropagation()
   if (activeTerminalId) {
     const result = terminalManager.redo(activeTerminalId)
     if (result) {
       window.api.pty.write(activeTerminalId, result.clearCmd)
       window.api.pty.write(activeTerminalId, result.newText)
     }
   }
   return
 }

 ---
 Phase 5: 考慮事項と制限

 課題と対策
 ┌──────────────────────────────┬───────────────────────────────────────────────────┐
 │             課題             │                       対策                        │
 ├──────────────────────────────┼───────────────────────────────────────────────────┤
 │ Ctrl+U等のシェル操作との競合 │ undo/redoコマンドが現在行にのみ作用することを想定 │
 ├──────────────────────────────┼───────────────────────────────────────────────────┤
 │ カーソル位置の管理           │ Ctrl+E（行末移動）を追加で送信                    │
 ├──────────────────────────────┼───────────────────────────────────────────────────┤
 │ 履歴の肥大化                 │ undoStackの最大サイズを100程度に制限              │
 ├──────────────────────────────┼───────────────────────────────────────────────────┤
 │ 単語単位削除（Ctrl+W）       │ 特別処理が必要（単語区切りで記録）                │
 └──────────────────────────────┴───────────────────────────────────────────────────┘
 制限事項

 1. シェルのコマンド履歴とは別
   - これは「現在入力中の行」のundo/redo
   - シェルの↑↓による履歴操作とは独立
 2. vim/nano等のエディタ内では無効
   - フルスクリーンアプリ内では動作しない
   - コマンドライン入力時のみ有効
 3. プロンプトの検知なし
   - シェルプロンプト表示の検知は実装しない
   - Enter押下をトリガーとして履歴リセット

 ---
 修正対象ファイル

 1. src/renderer/src/services/terminalManager.ts
   - TerminalInstance型に inputHistory を追加
   - getOrCreate内で初期化
   - onData内で履歴記録ロジック追加
   - undo(), redo(), resetInputHistory() 関数を追加
 2. src/renderer/src/App.tsx
   - Cmd+Z, Cmd+Shift+Z の処理を修正

 ---
 テスト方法

 # 基本テスト
 1. ターミナルで "hello world" と入力（Enterは押さない）
 2. Cmd+Z を押す → "hello worl" になる
 3. 何度か Cmd+Z → 入力が巻き戻る
 4. Cmd+Shift+Z → やり直しが効く
 5. Enter を押す → コマンド実行後、履歴リセット

 # 日本語テスト
 1. "こんにちは" と入力
 2. Cmd+Z → 文字が戻る

 # エッジケース
 - 空の状態でCmd+Z → 何も起きない
 - undoした後に新しい入力 → redoスタックがクリアされる

 ---
 実装優先順位

 1. Phase 1-2: 履歴スタックの追加と記録（基盤）
 2. Phase 3: undo/redo API
 3. Phase 4: キーボードショートカット修正
 4. Phase 5: テストと調整