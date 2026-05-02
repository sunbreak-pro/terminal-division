# HISTORY.md - 変更履歴

### 2026-05-02 - ズーム / split / scrollback 連鎖バグ修正（pty.resize debounce + Chromium 抑制）

#### 概要

ユーザー報告の 3 連続バグを根本原因まで掘り下げて修正。(1)「Cmd+\_ がまだ縮小として効く」: globalShortcut で intercept しないキーは Chromium が `prePerformKeyEquivalent:` で webFrame zoom として消費するため、`Cmd+= / Cmd+Plus / Cmd+Shift+= / Cmd+Shift+-` を no-op の SUPPRESS_ACCELERATORS として登録して抑制。フォントズームのアクティブショートカットは `Cmd+;`（拡大）と `Cmd+-`（縮小）と `Cmd+0`（リセット）の 3 つのみに整理。(2)「分割直後にスクロールバックが 2 文字幅で表示される」: `react-resizable-panels` を v2.1.7 → v4.5.9 にアップグレードした際の API 変更（数値 = ピクセル化）に追従漏れがあり、`defaultSize={50}` が 50% ではなく 50 ピクセルとして解釈されていた。`defaultSize="50%"` / `minSize="10%"` の percent string に修正。さらに `terminalManager.fit()` に `proposeDimensions()` の事前検証を追加し、`MIN_REASONABLE_COLS=5` 未満の異常値では `fitAddon.fit()` を呼ばない（呼ぶと scrollback が破壊的に reflow されて元に戻らない）。(3)「長文中に同じ文章が一つのパネル内に複数縦に並ぶ」: ペイン境界 drag や CSS transition で Panel.onResize / ResizeObserver がフレーム単位で発火し、毎フレーム `pty.resize` IPC → SIGWINCH → TUI（Claude CLI 等）が連続再描画 → 古い描画が scrollback に積層する SIGWINCH スパムが原因。`terminalManager.ts` に PTY 専用の trailing-debounce（80ms）を新設し、`fit()` 内部で `schedulePtyResize` を呼ぶ集中管理に切替。caller 側の `window.api.pty.resize` 二重呼び出し（TerminalPane.handleFit / applyOptions / SplitContainer.handlePanelResize）を撤去。`destroy(id)` でも保留中 timer をクリアして破棄済みペインへの IPC 漏洩を防止。テスト合計 33 ファイル / 484 件グリーン（修正前 479 から +5 件: proposeDimensions ガード 2 件 / pty.resize debounce 集約 + cancel + destroy クリーンアップ 3 件）。

#### 変更点

- **src/main/zoom-shortcuts.ts**: BINDINGS を `{ font-zoom:in: ["CommandOrControl+;"], font-zoom:out: ["CommandOrControl+-"], font-zoom:reset: ["CommandOrControl+0"] }` に統一。`SUPPRESS_ACCELERATORS = ["CommandOrControl+=", "CommandOrControl+Plus", "CommandOrControl+Shift+=", "CommandOrControl+Shift+-"]` を新設し、`registerAll()` 内で no-op コールバックの globalShortcut として登録 → OS レベルで先取り消費して Chromium のデフォルトズームに到達させない。`unregisterAll()` は SUPPRESS 分も REGISTERED に積んであるため自動的にクリーンアップされる
- **src/renderer/shortcuts/registry.ts**: `font-zoom-in` の defaultKey を `"Cmd+Plus"` → `"Cmd+;"` に変更。`Cmd+Plus` 用に書かれていた Shift 省略コメントを削除
- **src/renderer/App.tsx**: 早期 keydown ハンドラの `isZoomIn` マッチ条件を `e.key === "+" || (e.shiftKey && e.code === "Equal/Semicolon")` から `!e.shiftKey && (e.key === ";" || e.code === "Semicolon")` に書き換え。`Cmd+;` 単発の検出に純化
- **src/renderer/components/SplitContainer.tsx**: `<Panel minSize={10} defaultSize={100 / children.length}>` を `<Panel minSize="10%" defaultSize={`${100 / children.length}%`}>` に修正（v4 で number = px、string = % という新仕様に追従）。`handlePanelResize` から `window.api.pty.resize(panelId, ...)` を撤去（`terminalManager.fit()` 内部の debounce で集約）
- **src/renderer/services/terminalManager.ts**:
  - 定数 `MIN_REASONABLE_COLS = 5` を新設。`fit()` の `tryFit()` 内で `fitAddon.proposeDimensions()` を先に呼んで cols/rows を検証し、`cols < MIN_REASONABLE_COLS || rows <= 0` のときは `fitAddon.fit()` を呼ばずに null 返却（scrollback の破壊的 reflow を防止）
  - `PTY_RESIZE_DEBOUNCE_MS = 80` と `pendingPtyResizes: Map<id, { cols, rows, timer }>` を新設。`schedulePtyResize(id, cols, rows)` で既存予約を `clearTimeout` してから `setTimeout` で再スケジュール → 連続発火しても最終サイズだけが PTY に届く
  - `fit()` 内のサイズ変化判定後（または rAF retry 成功後）で `schedulePtyResize` を呼ぶよう変更。これにより caller が `window.api.pty.resize` を直接呼ばなくても自動的に PTY に伝わる
  - `destroy(id)` で `pendingPtyResizes.get(id)` を `clearTimeout` + `delete`（破棄済みペインへの IPC 漏洩防止）
  - テスト用 export `cancelPendingPtyResizes()` を追加
- **src/renderer/components/TerminalPane.tsx**:
  - `handleFit` から `window.api.pty.resize(id, result.cols, result.rows)` を撤去。`terminalManager.fit(id)` のみに簡略化（重複呼び出しは debounce を素通りして SIGWINCH スパムを再導入するため NG）
  - `applyOptions` の戻り値を握りつぶし、その後の `window.api.pty.resize` も撤去
- **src/renderer/components/settings/TerminalSettings.tsx**: 説明テキストを「`Cmd+= / Cmd+-` でアクティブペインのみ拡縮」→「`Cmd+; / Cmd+-` でアクティブペインのみ拡縮」に変更
- **新規テスト 5 件 (`renderer/services/__tests__/terminalManager.test.ts`)**:
  - `skips fit when proposeDimensions returns cols below MIN_REASONABLE_COLS`: 提案 cols=2 のときは `fitAddon.fit()` が呼ばれず null 返却
  - `skips fit when proposeDimensions returns undefined`: undefined 提案でも安全に null 返却
  - `coalesces rapid fit() calls into a single pty.resize (last value wins)`: 異なる 3 サイズで連続 `fit()` → debounce 中は IPC 0 件 / 80ms 経過後に最終サイズ 1 件のみ IPC される
  - `cancelPendingPtyResizes drops pending IPC`: pending を明示的にキャンセルすると 200ms 経過しても IPC されない
  - `destroy() cancels pending pty.resize for that id`: debounce 経過前に destroy → タイマーが解除され破棄済み id への IPC が飛ばない
- **既存テスト更新**:
  - `MockFitAddon` に `proposeDimensions = vi.fn(() => ({ cols: 80, rows: 24 }))` を追加（既定で妥当な提案を返す）
  - `terminalManager` の rAF retry テストを fake timers に切替えて 100ms 進めて `pty.resize` の呼び出しを検証
  - `SplitContainer.test.tsx` / `TerminalPane.test.tsx`: 「fit + 直 IPC」検証から「invalidate + fit のみ呼ばれる」検証に書き換え（pty.resize は terminalManager 内部の debounce 経由になったため、コンポーネント層では検証しない）
  - `registry.test.ts`: `font-zoom-in default is Cmd+Plus` → `Cmd+;` に更新
- **テスト合計**: 33 ファイル / 484 件グリーン（修正前 479 から +5 件）+ `npm run build` 通過
- **設計判断**:
  - **Chromium デフォルトズーム抑制を SUPPRESS_ACCELERATORS でやる根拠**: Electron の `webContents.setVisualZoomLevelLimits` は pinch zoom 専用で、キーボードショートカットには効かない。`before-input-event` で `preventDefault` する手もあるが、Chromium は `prePerformKeyEquivalent:` でこれより前にズームを発火する。OS レベルの globalShortcut は最も早い経路に乗り、no-op コールバックを置くだけで Chromium への到達を遮断できる
  - **`Cmd+;` 単発を拡大に選んだ理由**: ユーザー要望「`Cmd+Shift+; / Cmd+Shift+=` の 2 候補を `Cmd+;` 一つだけにして」に従う。Shift なしの `;` キー単体は `Plus` キーと違って US/JIS の差を受けず一意で、`Cmd+,`（設定）の隣で運指も近い。Chromium のデフォルトとも衝突しない
  - **`react-resizable-panels` v4 で number→px に変わった経緯**: v2/v3 は `defaultSize={50}` を 50% として解釈していたが、v4 で「数値 = px」「文字列 = %」と仕様変更された（CSS の他単位 `rem`/`vh` 対応のため）。マイグレーションガイドを見落としていたため `defaultSize={50}` が 50px として解釈され、splitter 直後にペイン幅が 50px → xterm fit-addon が `MINIMUM_COLS=2` までクランプ → scrollback が破壊的に再 wrap される連鎖が起きていた
  - **`MIN_REASONABLE_COLS=5` 未満で fitAddon.fit を見送る理由**: xterm の MINIMUM_COLS=2 まで落ちると `terminal.resize(2, rows)` がそのまま走って scrollback が 2 文字幅で再 wrap される。reflow はロスを伴うため、後で広い cols に戻しても元の見た目には戻らない（80 文字行が 40 行 × 2 文字に分割されたまま固着）。`proposeDimensions()` で先に検証して `fitAddon.fit()` 自体を呼ばないことが正しい防御
  - **PTY resize の trailing-debounce を 80ms に設定**: drag-resize の体感的な「区切り」（指がやや止まる瞬間）が 50〜100ms 程度。80ms は: (a) drag 中の連続発火を確実に集約、(b) drag 終了後の最終 SIGWINCH を素早く届ける、のバランス。長すぎると release 後にカーソル位置がしばらく古い cols のまま残る違和感が出る
  - **xterm 側 reflow は即時 / PTY 側 SIGWINCH は debounce の二段構え**: xterm の `terminal.resize()`（fitAddon.fit 内部）は即時実行して見た目をスムーズに追従させ、PTY への通知だけ集約する。これにより drag 中の視覚的レスポンスは保ちつつ、TUI（Claude CLI / Vim 等）の連続再描画を防げる。debounce 中の 80ms 間は xterm.cols=40 / PTY.cols=80 の不整合があるが、PTY からの出力を xterm が wrap するだけなので実害なし
  - **caller 側の `window.api.pty.resize` を撤去した理由**: `fit()` 内部で `schedulePtyResize` を呼ぶ仕様にしたあと、caller が直接 `window.api.pty.resize` を呼ぶと debounce を素通りして SIGWINCH スパムが復活する。「fit を呼んだら pty も resize される」という単一責務に統一し、TerminalPane.handleFit / applyOptions / SplitContainer.handlePanelResize の 3 箇所から重複呼び出しを撤去
  - **`destroy(id)` で pendingPtyResizes をクリアする根拠**: ペイン close 直後にまだ debounce が経過していない pty.resize が残っていると、`window.api.pty.resize(deadId, ...)` が main プロセスへ飛ぶ。Main 側は知らない id を握りつぶすだけだが、IPC リソースの無駄遣い + ログノイズ + 将来 main 側で warn を出すようにすると誤報になる。同 destroy 内で `lastSizes.delete(id)` / `pathBuffers.delete(id)` をしているのと同じ性質のクリーンアップ
  - **`pty.create` 直後の初期 resize は debounce 経由にしない**: TerminalPane の pty.create flow にある `window.api.pty.resize(id, cols, rows)` は startup の one-shot で、direct 呼び出しのまま残した。これは「PTY が初期出力を流す前に正しい cols を知っておく必要がある」一種の同期点で、80ms 遅らせると zsh 起動メッセージが小さい cols（24 cols のシェルデフォルト）で wrap されるため。fit 経由ではないので新 debounce path とは独立に動く
  - **テスト書き換えの方針**: SplitContainer / TerminalPane の責務が「fit を呼ぶ」までになったので、コンポーネント層では `pty.resize` を検証しない。`pty.resize` の挙動は `terminalManager.test.ts` でドメインごとにカバー（debounce coalesce / cancel / destroy）。これにより責務境界が tests に反映され、将来 caller を増やしても terminalManager 側のテストでデバウンスが担保される
  - **既知の Issue #002（scrollback cols 不整合）との関係**: 2026-04-27 のフィックスでは「fit が呼ばれない経路」を 5 つ塞いだが、今回見つかった「fit が**呼ばれすぎる**経路」は対角線の問題。`MIN_REASONABLE_COLS` ガード + pty.resize debounce で双方向の防御が揃う

### 2026-05-02 - Chat UI 完全廃止（T3-5 撤回）

#### 概要

T3-5 として実装した Claude Code Chat UI を機能ごと撤回。Claude サブスクリプション認証を内蔵したまま第三者にビルドが渡るリスク（規約上グレー〜アウト）を避けるため、コードを残さず完全削除した。`viewMode: "cli" | "md" | "chat"` を `"cli" | "md"` に縮約、`AppSettings.chat` を schema から除去、`chat:*` IPC 10 チャネル全廃。削除直前のコードは `pre-chat-removal` タグで保全しているため、復活時は git history から個別 cherry-pick 可能。テスト 479 件・electron-vite build 全グリーン。（計画書: archive/2026-04-30-remove-chat-ui.md）

#### 変更点

- **削除（17 ファイル）**: `src/renderer/components/ChatPane/` 配下 8 ファイル（ChatPaneView / MessageList / MessageBubble / ChatInput / ChatStatusBar / ChatWelcome / ChatTrustPanel / SlashMenu）、`src/renderer/stores/chatSessionStore.ts` + テスト、`src/renderer/services/chatBridge.ts`、`src/renderer/types/chat.ts`、`src/main/chat-session-manager.ts`、`src/main/claude-process-detector.ts` + テスト、`src/main/slash-items.ts` + テスト、`src/main/trusted-dirs.ts` + テスト、`src/shared/chat-events.ts`
- **部分修正（17 ファイル）**: `src/main/ipc-handlers.ts`（chat:_ ハンドラ 8 種 + import 3 行 + before-quit の killAll 削除）、`src/main/window-manager.ts`（chatSessionManager / claudeProcessDetector の register/unregister 削除）、`src/main/pty-manager.ts`（claudeProcessDetector.feedChunk / reset 3 箇所削除）、`src/preload/index.ts`（`window.api.chat` ブリッジ全削除 + ChatEventEnvelope import 削除）、`src/renderer/main.tsx`（initChatBridge 削除）、`src/renderer/App.tsx`（CHAT*FONT_SIZE*_ import 削除、resolveActiveViewMode の戻り型を `"cli" \| "md" \| null` に縮約、adjustGlobalFontSize / resetGlobalFontSize から chat 分岐削除）、`src/renderer/components/TerminalPane.tsx`（ChatPaneView import / showChat / mountChat / hasChatSession 削除）、`src/renderer/components/TerminalSubHeader.tsx`（CLI/Chat segmented タブ + 「Chat 起動」吹き出しアイコン削除、handleClickChatTab / handleCloseChatTab / handleStartChat 削除、segmentStyle 関数削除）、`src/renderer/stores/terminalMetaStore.ts`（ViewMode を `"cli" \| "md"` に縮約）、`src/renderer/stores/terminalStore.ts`（chatSessionStore import + closeTerminal 内の chat.dispose / remove 削除）、`src/renderer/stores/settingsStore.ts`（patch.chat マージ + useChatSettings セレクタ削除）、`src/renderer/stores/__tests__/terminalStore.test.ts`（window.api.chat モック削除）、`src/shared/settings.ts`（ChatSettings 型 / validateChatSettings / CHAT_FONT_SIZE_MIN/MAX 定数 / DEFAULT_SETTINGS.chat / cloneDefaults / mergeSettings / validateAppSettings の chat フィールド全削除）、`src/shared/__tests__/settings.test.ts`（base AppSettings の chat フィールド + chat clamp 2 ケース削除）、`.claude/CLAUDE.md`（§T2-10 から chat 記述全削除）、`.claude/docs/known-issues/INDEX.md`（Issue 003 を Withdrawn セクションへ移動）
- **アーカイブ移動**: `.claude/docs/known-issues/003-claude-cli-stream-json.md` → `.claude/docs/known-issues/archive/003-claude-cli-stream-json.md`（Status を Withdrawn に更新）
- **既存 archive 更新**: `.claude/archive/2026-04-29-claude-code-chat-ui.md` の Status を COMPLETED → WITHDRAWN、Withdrawn 日付・理由を追記
- **IPC チャネル削除**: `chat:start` / `chat:send` / `chat:stop` / `chat:dispose` / `chat:getSessionId` / `chat:checkTrust` / `chat:trust` / `chat:listSlashItems` / `chat:event` / `chat:claudeDetected` の計 10 種
- **Branch / Tag**: `feat/remove-chat-ui` ブランチで作業中（main からは未マージ）。削除直前のスナップショットを `pre-chat-removal` タグで保全（main の HEAD = 41322e2 の `chore(chat): WIP polish snapshot before removal` を指す）。復活時は `git checkout pre-chat-removal -- <path>` で個別取得可能
- **残存リスク（記録）**: 既存ユーザーの `userData/trusted-dirs.json` は削除されないが、Reader が消えたため不活性ファイル化するだけで実害なし。次バージョンで起動時 cleanup を入れるかは別タスクで判断
- **Coding 判断**: trusted-dirs / slash-items / claude-process-detector は他用途への流用可能性があったが、構造的に chat 専用 API 形状（CWD 信頼確認 / `/` コマンド補完 / OSC 0 ✳ Claude Code バナー検出）であり、汎用的な再利用には設計しなおしが必要なので機能ごと削除した

### 2026-04-30 - アプリ全体ズーム機能追加 + per-pane フォントズームを MD/Chat に拡張

#### 概要

ユーザー要望「Cmd+= / Cmd+- が現状ターミナルに絞られているが、本来はアプリ画面全体の拡大縮小を意図したかった。今のターミナル個別ズームは残したまま、別途アプリ全体ズーム機能を追加してほしい。さらにターミナルの拡大縮小は markdown / chat にも対応させてほしい」を実装。アプリ全体ズームは `general.appZoomFactor`（既定 1.0、範囲 0.5〜2.0、step 0.1）を新設し、preload で `webFrame.setZoomFactor` を直接ブリッジ（contextIsolation 下でも preload は webFrame を呼べるため IPC 不要）。Renderer の App.tsx で `useSettingsStore` を購読し設定変更ごとに即時適用（idempotent setter なのでクリーンアップ不要）。Settings の「一般」タブに − / 倍率表示 / + / リセット + 範囲スライダーを追加。per-pane ズーム（Cmd+= / Cmd+- / Cmd+0）はアクティブペインの `viewMode` に応じてターゲットを切替: `cli` → `terminal.fontSize`（既存挙動維持）/ `md` → `editor.fontSize`（MarkdownEditor は元から `editorSettings.fontSize` を参照していたため自動連動）/ `chat` → 新規 `chat.fontSize`（既定 13.5、範囲 10〜28、ChatInput と MessageBubble の本文に反映）。`adjustGlobalFontSize` / `resetGlobalFontSize` を viewMode 分岐に書き直し、各々のクランプ範囲・既定値で動かす。`shared/settings.ts` に `ChatSettings` 型 / `validateChatSettings` / `mergeSettings` の chat 対応 / `APP_ZOOM_MIN/MAX/STEP` / `CHAT_FONT_SIZE_MIN/MAX` 定数を追加し、`general.appZoomFactor` も `clampNumber` で範囲検証。ChatInput の textarea 自動高さ計算に `chatSettings.fontSize` を依存追加してフォントサイズ変更時に即追従。設定 UI のリセット / 増減ボタンは APP_ZOOM_MIN/MAX 端点で disabled。テスト合計 37 ファイル / 514 件グリーン（chat / appZoomFactor の clamp / fallback / 破損ブロック復元の 4 ケース追加）。CLAUDE.md §8 T2-10 を新仕様（viewMode 分岐 + アプリ全体ズーム）に更新。

#### 変更点

- **shared/settings.ts**: `ChatSettings { fontSize: number }` を新規追加、`AppSettings` と `PartialAppSettings` に `chat` を組み込み。`general.appZoomFactor: number` を `GeneralSettings` に追加し、`validateGeneralSettings` で `clampNumber(value, APP_ZOOM_MIN, APP_ZOOM_MAX, default)` の検証を実装。`validateChatSettings` を新設し `clampNumber(value, CHAT_FONT_SIZE_MIN, CHAT_FONT_SIZE_MAX, default)` で fontSize 検証。定数 `APP_ZOOM_MIN=0.5` / `APP_ZOOM_MAX=2.0` / `APP_ZOOM_STEP=0.1` / `CHAT_FONT_SIZE_MIN=10` / `CHAT_FONT_SIZE_MAX=28` を export。`DEFAULT_SETTINGS.chat.fontSize=13.5` / `DEFAULT_SETTINGS.general.appZoomFactor=1.0`。`mergeSettings` / `cloneDefaults` / `validateAppSettings` の各所に `chat` の field-level マージを追加
- **renderer/stores/settingsStore.ts**: `applyOptimistic` に `patch.chat` の浅マージを追加。新規セレクタ `useChatSettings` を export
- **preload/index.ts**: `electron` から `webFrame` を import し、`window.api.window.setZoomFactor(value: number)` を新規公開。finite check + try/catch でガード（範囲外でも黙って無視）。webFrame は preload context で直接呼べるため Main 側の IPC ハンドラ不要
- **renderer/App.tsx**:
  - `resolveActiveViewMode()` ヘルパを新設（`useTerminalStore.getState().activeTerminalId` → `useTerminalMetaStore.getState().metas.get(id)?.viewMode` を返す、null フォールバック）
  - `adjustGlobalFontSize(delta)` を viewMode 分岐に書き直し: `md` → `editor.fontSize` をクランプ更新 / `chat` → `chat.fontSize` をクランプ更新 / `cli` or null → `terminal.fontSize`（既存挙動）。各々 no-op early return + クランプ範囲は対応定数を使用
  - `resetGlobalFontSize()` も同様の分岐: `md` → `DEFAULT_SETTINGS.editor.fontSize` / `chat` → `DEFAULT_SETTINGS.chat.fontSize` / `cli` or null → `terminal.fontSize=14` + `clearAllFontSizeOverrides()`
  - `useTerminalStore` を import に追加（既存の selector hook と並行して getState 用）
  - 新規 `useEffect`: `useSettingsStore((s) => s.settings.general.appZoomFactor)` を購読し変化時に `window.api.window.setZoomFactor(appZoomFactor)` を呼ぶ。起動直後 1.0 で 1 度走り、`load()` 完了後の永続化値で再走する
- **renderer/components/settings/GeneralSettings.tsx**: 「アプリ全体の表示倍率」セクションを追加。`setAppZoom(next)` で小数 2 桁丸め + クランプ + `update({ general: { appZoomFactor } })` を発火。− / 倍率%表示 / + / リセットボタン + range スライダー (`APP_ZOOM_MIN`〜`APP_ZOOM_MAX`、step `APP_ZOOM_STEP`)。端点で disabled、リセットボタンは既定値との差が < 1e-6 のとき disabled。説明文に「ターミナル個別フォントズーム (⌘+ / ⌘− / ⌘0) と独立で併用可能」を明記
- **renderer/components/ChatPane/ChatInput.tsx**: `useChatSettings` を import、textarea の `fontSize: 13.5` ハードコードを `chatSettings.fontSize` に置換。textarea 高さ自動計算 `useLayoutEffect` の依存配列に `chatSettings.fontSize` を追加（フォントサイズ変更時に line-height 換算が変わるため即時 re-fit が必要）
- **renderer/components/ChatPane/MessageBubble.tsx**: `useChatSettings` を import、`bubbleStyle` 内の `fontSize: 13.5` を `chatSettings.fontSize` に置換し useMemo deps に追加
- **`.claude/CLAUDE.md` §8 T2-10**: 「カスタマイズ拡張」の説明を新仕様に更新。`AppSettings` の構成を `terminal / editor / chat / general` に拡張、`appZoomFactor` を一般設定に追加、フォントズームを「viewMode に応じて cli → terminal.fontSize / md → editor.fontSize / chat → chat.fontSize に分岐するグローバル設定直接更新」と再記述、アプリ全体ズームを「preload 経由 webFrame.setZoomFactor で適用、50%〜200%、ターミナル個別ズームと独立併用可」と追記
- **新規テスト 4 件 (`shared/__tests__/settings.test.ts`)**:
  - `merges chat patch and clamps fontSize`: 下限 1 → 10 / 上限 999 → 28 / 範囲内 16 → 16 を確認
  - `merges general.appZoomFactor and clamps to APP_ZOOM bounds`: 下限 0.1 → 0.5 / 上限 5 → 2.0 / 範囲内 1.25 → 1.25 を確認
  - `falls back appZoomFactor to default for non-numeric values`: `"big"` → DEFAULT
  - `validateAppSettings restores chat defaults for malformed chat block`: `"garbage"` → `DEFAULT_SETTINGS.chat`
- **既存テスト更新**: `mergeSettings` の `base` AppSettings に `chat: { ...DEFAULT_SETTINGS.chat }` を追加（必須フィールド追加に伴う TS エラー解消）
- **テスト合計**: 37 ファイル / 514 件グリーン（修正前 510 から +4 件）+ `npm run build` 通過
- **設計判断**:
  - **アプリ全体ズームを `webFrame.setZoomFactor` 経由にした理由**: CSS `zoom` / `transform: scale` ではターミナルの ResizeObserver / xterm.fit と整合せず cols/rows が乖離しやすい。`webFrame.setZoomFactor` は Chromium がレンダリング全体に均一スケールを適用するため CSS 計算値（getComputedStyle 等）を含めて綺麗に拡縮される。Electron の標準 zoom 機構なのでメインプロセスを介さずに preload から直接呼べるのも利点
  - **preload で webFrame を直接呼ぶ vs Main 経由 IPC**: contextIsolation 下でも preload は Electron API にフルアクセスできるため、ズーム適用のような副作用なし・即時 setter は preload で完結させた方がレイテンシゼロで簡潔。ウィンドウ間の同期も不要（各ウィンドウが独立して同じ settings を購読する設計のため、自然に揃う）
  - **viewMode 分岐 vs ペイン別 fontSize**: 「Chat ペインだけ大きく / MD ペインだけ小さく」というユースケースは現状想定されないため、各タイプ共通のグローバル設定を更新する形にした。既存ターミナルの挙動と一貫し、Settings UI のスライダーと常に同期する利点も継承
  - **chat fontSize は本文（バブル + 入力欄）のみに適用、ステータスバー等は据え置き**: チャット UI 内には fontSize ハードコードが多数（ステータスバー / Welcome / Trust Panel / SlashMenu 等）あるが、これらは補助 UI で本文ではない。Cmd+= で本文のみ拡縮するのがユーザー期待（メッセージを読みやすくしたい）に合致し、補助 UI まで拡縮するとレイアウト崩れリスクが上がる
  - **ChatInput の textarea 高さ依存に fontSize を追加**: useLayoutEffect が `[value]` のみ依存だと、フォントサイズだけ変わって `value` が同じケース（拡大直後など）に高さ再計算が走らず、line-height ベース計算と実際の表示にズレが出る。依存追加で初回拡縮直後から正しい高さに収束
  - **アプリ全体ズームの範囲を 0.5〜2.0 に絞った理由**: Electron の webFrame は 0.25〜5.0 を許容するが、0.25 ではトラフィックライト等の OS UI と崩れ、3.0 以上ではターミナルの cols が 10 を切って実用にならない。実用域として 50%〜200% に限定
  - **既存ターミナル挙動の互換性維持**: `viewMode === "cli"` または `null`（ペイン未確定）時は元の `terminal.fontSize` 更新ロジックを完全保持。`Cmd+0` の reset 値も既存の 14 を踏襲（`DEFAULT_SETTINGS.terminal.fontSize=13` との差は旧仕様からの引き継ぎで、エディタ/チャットだけ DEFAULT_SETTINGS から値を取る）
  - **General settings タブで完結 vs ショートカット追加**: ユーザー要望「Settings の場所は一般タブで OK」に従い、ショートカットは追加せずスライダー + ボタンのみ。後日要望があればショートカット ID `app-zoom-in/out/reset` を追加できるよう registry を拡張可能な状態に保つ

### 2026-04-29 - フォントズームのキーバインド修正（globalShortcut + Settings 連動）+ Header 整理 + per-pane close button

#### 概要

ユーザー報告の 3 連続ショートカット問題を順に切り分け、最終的に Chromium のキーディスパッチ仕様に行き当たった。`Cmd+=` は renderer の keydown まで到達するが `Cmd+-` は到達しない（Chromium の `prePerformKeyEquivalent:` がアプリ層でステップ 2 のズーム処理として消費する）ため、Electron メニューアクセラレータも `before-input-event` も間に合わない。`globalShortcut.register("CommandOrControl+-")` で OS 直接のキー監視に乗せ、フォーカス時のみ register / blur で unregister するフォーカス条件付きのグローバルショートカットを `src/main/zoom-shortcuts.ts` に新設。同時に `Cmd+=` / `Cmd+0` / 代替の `Cmd+Shift+-` も同じ仕組みで登録し、メニューアイテムは accelerator なしのクリックハンドラ（IPC 送出）に簡素化した。これとは別系統で「Settings のフォントスライダーが拡大時に同期しない」問題を、per-pane の `fontSizeOverride` を直接動かす方式から **グローバル `Settings.terminal.fontSize` を直接更新する方式** に切替、`adjustGlobalFontSize` / `resetGlobalFontSize` を Renderer 側に新設。`Cmd+0` はファクトリー既定値 14 に戻す挙動に統一。あわせて UI 整理として、`Header` 右端の閉じるボタンとテーマ選択ドロップダウンを撤去（テーマは Settings に集約済み）し、各ペインの `TerminalSubHeader` 右端に × ボタンを追加（dirty MD タブがある場合は `UnsavedChangesModal` で警告フローに乗る）。Header / TerminalPane の既存テストを新仕様に書き換え、合計 35 ファイル / 500 件グリーン。

#### 変更点

- **新規 `src/main/zoom-shortcuts.ts`**: フォーカス条件付き globalShortcut 登録モジュール。`browser-window-focus` で `CommandOrControl+=` / `CommandOrControl+Shift+=` / `CommandOrControl+-` / `CommandOrControl+Shift+-` / `CommandOrControl+0` を登録、`browser-window-blur` で全 unregister。これによりフォーカス時のみキーを奪い、他アプリ使用中は素通しさせる。コールバックは `BrowserWindow.getFocusedWindow().webContents.send("font-zoom:in/out/reset")` で IPC 送出
- **`src/main/index.ts`**: `setupZoomShortcuts()` を `app.whenReady` 内で呼出 + `app.on("will-quit", teardownZoomShortcuts)` でクリーンアップ
- **`src/main/menu.ts`**: 「表示」メニューに「フォント拡大 / 縮小 / リセット」を追加。**accelerator は付けず click のみ**（globalShortcut と二重登録すると挙動が不安定）。click は `webContents.send("font-zoom:*")` を発火するだけ
- **`src/preload/index.ts`**: `window.api.menu.{onFontZoomIn,onFontZoomOut,onFontZoomReset}` を公開。`createIpcListener<void>` で wrap
- **`src/renderer/App.tsx`**:
  - `adjustActivePaneFontSize`（per-pane override 操作）を撤去し、`adjustGlobalFontSize(delta)` / `resetGlobalFontSize()` を新設。前者は `useSettingsStore.getState().update({ terminal: { fontSize: clamp(current + delta, MIN, MAX) } })` で **グローバル設定を直接更新**、後者はファクトリー既定値 14 にリセット + `clearAllFontSizeOverrides()` も呼ぶ
  - メニュー IPC リスナーを `useEffect` で購読し、`onFontZoomIn` → `adjustGlobalFontSize(+1)` 等にディスパッチ
  - registry-based handler の `font-zoom-in/out/reset` も同関数を呼ぶよう統一（カスタムバインドからの経路でも同じ挙動）
  - keydown 早期 fallback の `isZoomOut` マッチ条件に `e.keyCode === 189` を追加（IME / 配列違いで `e.key`/`e.code` が想定外でも拾えるように）。`isZoomReset` も同様に `e.keyCode === 48` 追加
- **`src/renderer/stores/settingsStore.ts`**:
  - `update(patch)` 内で `patch.terminal.fontSize !== current.terminal.fontSize` のときに `useTerminalMetaStore.getState().clearAllFontSizeOverrides()` を呼ぶ side-effect を追加。Settings からのスライダー操作で全ペインの override が解除され、新しい `fontSize` が即時反映される
- **`src/renderer/stores/terminalMetaStore.ts`**:
  - `clearAllFontSizeOverrides: () => void` action を新設。null 以外の override が 1 つでもあるときだけ `set({ metas: next })` で再描画トリガを最小化（fontSizeOverride を保持しているのは UI レイヤだけなのでバルク操作で十分）
- **`src/renderer/shortcuts/registry.ts`**:
  - `font-zoom-in` のデフォルトキーを `Cmd+=` から `Cmd+Plus` に変更（表示は `⌘ +`）。`normalizeKeyName` に `+ → Plus` エイリアスを追加し、`parseKey` は `keyName === "Plus"` のとき Shift を省く（US の `Cmd+Shift+=` も JIS の `Cmd+Shift+;` も同じ `Cmd+Plus` に正規化される）
  - `canonicalize` を拡張して末尾 `++` を `+Plus` にプリプロセス（`Cmd++` 表記も受理）
  - `DISPLAY_MAP` に `Plus → "+"` 追加
- **`src/renderer/components/SplitContainer.tsx`**: `Panel.onResize` の `handlePanelResize` で `fit()` 前に `terminalManager.invalidateLastSize(panelId)` を呼ぶ。兄弟ペイン削除直後の expand で `lastSizes` キャッシュが古い値のまま `pty.resize` を抑止する不具合（scrollback の細長表示）を修正
- **`src/renderer/components/TerminalPane.tsx`**: md/chat → cli 復帰時の `useLayoutEffect` に `requestAnimationFrame` ベースの 2 度目 `invalidateLastSize + handleFit` を追加。`useLayoutEffect` 1 回目は `display:none → block` のレイアウト未確定で 0-cols 失敗することがあるため、paint 後に再フィットする保険
- **`src/renderer/components/Header.tsx`**: 大幅整理。
  - **削除**: 右端の「閉じる (Cmd+W)」ボタン、テーマ選択 `<select>` ドロップダウン
  - これに伴い `useTerminalCount` / `useAvailableThemes` / `useSetTheme` / `closeTerminal` / `handleClose` / `handleCloseButton*` / `handleThemeChange` / `closeButtonStyle` / `canClose` を撤去
  - 残す UI: Sidebar トグル / 縦分割 / 横分割 / ディレクトリ移動 / 設定
- **`src/renderer/components/TerminalSubHeader.tsx`**:
  - 各ペインのヘッダー右端に × 閉じるボタンを追加（`useTerminalActions` / `useTerminalCount` を購読）。`terminalCount > 1` のときのみ有効、最後の 1 ペインは disabled
  - `handleClosePane` は dirty な MD タブが存在すれば `useMarkdownDialogStore.showUnsaved({ reason: "close-pane", onSave / onDiscard })` で警告フローに乗せる。dirty なしなら即時 `closeTerminal(id)`
  - hover で danger カラーに反転、disabled 時は不透明度 0.4 + `cursor: not-allowed`
  - ペイン番号 span のフォントサイズを `meta?.fontSizeOverride ?? terminalSettings.fontSize` に変更（Cmd+= / Settings の双方で番号もターミナル本体も同寸で動く）
- **既存テスト改訂**:
  - `Header.test.tsx`: 削除済み UI（閉じるボタン / テーマ選択）の表示テストを除去し、代わりに「これらが描画されないこと」を assert する負のテストを追加。残す機能（split / directory / settings）のテストはそのまま
  - `TerminalPane.test.tsx`: TerminalSubHeader が `useTerminalCount` を購読するようになったため、mock に `useTerminalCount: vi.fn(() => 2)` を追加
  - `SplitContainer.test.tsx`: `terminalManager` mock に `invalidateLastSize: vi.fn()` を追加（handlePanelResize がそれを呼ぶようになったため）
- **テスト合計**: 35 ファイル / 500 件グリーン
- **設計判断**:
  - **`Cmd+-` を globalShortcut に逃がす根拠**: Chromium の macOS キーディスパッチは `OS → アプリ固有 (`prePerformKeyEquivalent:`) → メニュー → before-input-event → renderer keydown` の順で動き、ズームショートカットはステップ 2 で消費される。Electron メニューに `accelerator: "CommandOrControl+-"` を登録しても、ステップ 2 の消費の方が先に走るため安定して上書きできない（ユーザー実機で再現確認済み: `[zoom-diag keydown]` ログが Cmd+= では出るが Cmd+- では出ない）。globalShortcut は OS が直接ハンドルする経路に乗るため、Chromium のステップ 2 に到達する前にコールバックが走る
  - **focus-conditional な globalShortcut**: 真にグローバルに register したまま放置すると他アプリ操作中の `Cmd+-` も奪ってしまう。`browser-window-focus`/`blur` で register/unregister することで、フォーカスがあるときだけインターセプトする UX に揃える
  - **Settings 直接更新方式 vs per-pane override**: 旧仕様は `Cmd+=` で `fontSizeOverride` を弄り、Settings.fontSize は触らない方針だったが、ユーザーから「Settings のスライダーが連動しない」「override が積まれて Settings 操作が効かなくなる」の 2 件報告を受けて方針転換。グローバル `Settings.terminal.fontSize` を直接動かすことで、(a) スライダーが常に現在値を反映、(b) 全ペインが同期、(c) override 不在で挙動が単純化、を同時に達成。per-pane override の余地は内部に残しているが、現在の Cmd+= 系経路では使わない
  - **Header 整理の方針**: 閉じるボタンは「対象ペインが分かりにくい」（アクティブペインが暗黙的）という UX 課題があり、各ペインのヘッダーに × を置くことで操作対象が視覚的に明示される。テーマ選択は Settings の「外観」タブに既に存在するため Header 上で重複していた。両者を撤去することで Header の右側ブロックがすっきり、Settings ボタン押下のみへ集約
  - **TerminalSubHeader の × ボタンも dirty 警告フローを踏襲**: 既存の Cmd+W ショートカットと同じ `UnsavedChangesModal` を再利用することで、ペイン閉鎖の警告 UX が 2 経路で同一化（保存 / 破棄 / キャンセル の 3 ボタン）
  - **メニューアイテムから accelerator を外した理由**: globalShortcut と menu accelerator を同じキーに二重登録すると、片方が登録失敗したり順序が不定になる事例があるため。globalShortcut が一次的に責任を持ち、メニューアイテムは「クリックでも実行できる UI ガイド」として残すだけにする

#### 概要

T3-5 Claude Code Chat UI を MVP として完成させ、同時に Markdown エディタを 1 ペインあたり最大 8 タブまで開ける構成へ拡張。Chat バックエンドは `claude -p --input-format stream-json --output-format stream-json --include-partial-messages --verbose --session-id <uuid>` を子プロセス起動し、stdout を行バッファリングで JSON.parse、`stream_event.content_block_delta.text_delta` を逐次描画。PTY 出力監視で OSC 0 `✳ Claude Code` を検出すると自動で Chat ビューに切替える。アシスタント発言には ✳ アバターを表示し、ストリーミング中は ChatStatusBar が現在の作業（思考中 / Bash 実行中 等）を表示、ツール使用は MessageBubble 内の折りたたみカードに inline 表示。CLI ↔ Chat の手動切替で会話継続させるための「CLI で続きを表示」ボタン（`pty.write("claude --resume <id>\\n")`）を追加。複数 MD タブはタブ列右の「+」ボタンドロップダウン（検索フィールド + 全 watch 中 CWD 配下の .md 最大 50 件 + ファイル選択ダイアログ）から開け、上限 8 件到達時は + ボタンが disabled。session-state.json の `SerializedMeta.mdTabFilePaths` で MD タブの filePath を永続化し、復元時は MarkdownEditor が mount 時に `fs.readFile` → `markMdSaved` で内容を再ロード。Phase 0 で実機検証した stream-json プロトコル仕様は `.claude/docs/known-issues/003-claude-cli-stream-json.md` に記録（Status=Monitoring）。テスト合計 35 ファイル / 502 件グリーン。

#### 変更点

- **Chat backend (Main)**:
  - `chat-session-manager.ts` 新規: `child_process.spawn("claude", [...])` でセッション管理、stdin に JSONL 書込、stdout を 1MB 上限の行バッファリングで JSON.parse、`session_id` 抽出、`assistant.error="authentication_failed"` 早期検出、SIGTERM による stop / dispose
  - `claude-process-detector.ts` 新規: PTY 出力 chunk から OSC 0 `\x1b]0;✳ Claude Code\x07` を 256B リングバッファで chunk 跨ぎ込みで検出。フォールバックは `]0;` + `Claude Code\x07` の同居要求（誤検出回避のため BEL 直後を要求）
  - `cli-resolver.ts` 新規: `getMergedPath()` で PATH 走査 + `~/.local/bin/claude` フォールバック + プロセス内キャッシュ
  - `pty-manager.ts` 修正: onData hook で detector に chunk を流す + kill 時に detector reset
  - `ipc-handlers.ts` / `window-manager.ts` 修正: `chat:start` / `chat:send` / `chat:stop` / `chat:dispose` / `chat:getSessionId` / `chat:event` / `chat:claudeDetected` を追加 + ウィンドウ生成 / 破棄で chat / detector の register/unregister
- **Chat frontend (Renderer)**:
  - `shared/chat-events.ts` 新規: `ChatEventEnvelope` 型を Main / preload / Renderer 共通定義
  - `chatSessionStore.ts` 新規: paneId ごとに `messages` / `currentAssistantBuffer` / `currentMessageId` / `currentActivity` / `pendingToolUses` / `sessionId` / `status` / `lastError` を保持。空コンテンツでの `finalizeAssistantMessage` は message を作らない（空 bubble 抑制）
  - `chatBridge.ts` 新規: `chat:event` を消費して `stream_event` の `content_block_start/delta/stop` を SSE 互換に変換、`message_start` で `beginAssistantMessage`、`text_delta` を `appendAssistantDelta` に流す。`session_already_started` エラー時は `getSessionId` で取得して silent 復帰、`startChatSession` 成功時に `setStatus("idle")` に遷移
  - `ChatPane/ChatPaneView.tsx`: コンテナ。useEffect 一本で `chat:start`、停止後の入力で自動 `--resume` 再起動 + 送信、`onContinueInCli` で PTY に `claude --resume <id>` を投入
  - `ChatPane/MessageBubble.tsx`: ✳ アバター + 思考過程 details + tool_use 折りたたみカード（ToolUseChip: Bash/Read/Edit/Write/Glob/Grep の input サマリー + result/error 展開）+ fenced code / inline code の軽量 Markdown レンダラ
  - `ChatPane/ChatInput.tsx`: 1〜3 行自動高さ拡張 + 4 行以上は固定 max-height + 内部スクロール、IME ガード（compositionStart/End）、Enter 送信 / Shift+Enter 改行 / Cmd+Enter 送信、64KB 警告
  - `ChatPane/ChatStatusBar.tsx`: starting / streaming（thinking | text | tool_use を `formatActivity` で表示）/ error / ended の 4 状態 + 再起動 / CLI に戻る / 「CLI で続きを表示」ボタン
  - `ChatPane/MessageList.tsx`: 自動スクロール（最下部追従）+ streaming 仮想 bubble は `streamingText.length > 0` のみ表示
- **複数 MD タブ (terminalMetaStore + UI)**:
  - `terminalMetaStore.ts` 大幅変更: 旧 `mdFilePath / mdSavedContent / mdDirty / mdLoadedAt` を撤廃し、`mdTabs: MdTab[]` + `activeMdTabId: string | null` に置換。新 actions: `openMarkdown`（同 path はアクティブ化、上限 8 で `{ok:false, reason:"limit"}`）/ `setActiveMdTab` / `closeMdTab`（左隣フォールバック、最後の 1 つで viewMode=cli 復帰）/ `setMdDirty(paneId, tabId, dirty)` / `markMdSaved(paneId, tabId, content)` / `canOpenMoreMd`
  - `MarkdownEditor.tsx`: `paneId` + `tabId` props で識別。mount 時 `savedContent === ""` なら `fs.readFile` → `markMdSaved` で復元時に自動ロード
  - `markdownEditorRegistry.ts`: キーを paneId → tabId に変更（ファイル自体は変えず使い分け規約のみ更新）
  - `markdownDialogStore.ts`: `UnsavedRequest.tabId` を必須化
  - `markdownOpenService.ts`: dirty 警告ロジックを撤去（タブ追加で済むため）+ 上限到達時 toast。`openMarkdownDirect` を export し MdTabPickerDropdown から呼ぶ
  - `MdTabPickerDropdown.tsx` 新規: タブ列右「+」クリックで開く Portal ドロップダウン。検索フィールド + watch 中の全 CWD を `searchTree` で再帰検索（最大 50 件、横スクロール対応）+ 末尾に「ファイルを選択...」(`dialog.selectFiles`)
  - `mdFileListing.ts` 新規: `listMarkdownFilesAcrossPanes(metas, query)` で .md / .markdown を CWD 重複排除 + path 重複排除しながら集約
  - `TerminalSubHeader.tsx` 大幅改修: タイトル/CWD を **常時表示** に変更（旧仕様ではタブ表示で消えていた問題を修正）。タブ列は `[CLI | mdTabs.map → + ボタン | Chat]`、+ ボタンは 8 タブ達成で disabled + non-active カーソル
  - `TerminalPane.tsx`: 全 mdTabs を mount し続けて active のみ display:block（CodeMirror 編集状態保持）+ Chat session が存在する間 ChatPaneView を mount し続ける（CLI 切替で ChatInput の useState を保持）
- **永続化**:
  - `shared/session-state-validator.ts`: `SerializedMeta.mdTabFilePaths?: string[]` を追加（最大 8 / 各非空）+ `SESSION_STATE_MAX_MD_TABS` 定数
  - `services/sessionPersist.ts`: `hasMdTabPathsChanged` を追加して filePath 変化で保存トリガ（dirty / loadedAt 変動は保存しない）
  - `services/sessionRestore.ts`: serialize 時に `mdTabs.map(t => t.filePath)` を出力 / restore 時に `hydrateMetas` に `mdTabFilePaths` を渡す
- **追加バグ修正**:
  - **CWD/タイトルが「CLI」に置換される**: TerminalSubHeader で常時表示の rename 可能 span を維持
  - **Chat 入力が CLI 切替で消える**: ChatPaneView を unmount せず display:none で隠す方式に変更
  - **Shift+Enter が CLI 側に流れる**: `App.tsx` の `EDITABLE_PASSTHROUGH_IDS` に `insert-newline` を追加（xterm helper textarea は除外されるので CLI 側挙動は不変）
  - **Chat の内容が CLI で見えない**: ChatStatusBar に「CLI で続きを表示」ボタン（クリックで PTY に `claude --resume <id>\\n` 投入）
  - **「セッションを開始しています」永続化**: `startChatSession` 成功時に `setStatus("idle")` 追加 + `session_already_started` エラー時に `getSessionId` で復帰
  - **二重起動 → 即 error**: `handleStartChat` / `handleClaudeDetected` は `setViewMode` のみに専念、バックエンド起動は ChatPaneView マウント時の useEffect 一本に集約
  - **claude-process-detector の定数バイト混入**: prettier が `\x1b` / `\x07` を実体バイトに変換して保存していたため、明示的なエスケープシーケンス文字列に書き直し（実値は同一だが Read で読み解ける形に）
- **新規テスト 31 件**:
  - `utils/__tests__/mdFileListing.test.ts` (8): 空 metas / cwd 重複排除 / .md 拡張子フィルタ / path 重複排除 / query 部分一致（case-insensitive）/ 50 件上限 + truncated / searchTree truncated 伝搬 / searchTree エラー無視
  - `stores/__tests__/chatSessionStore.test.ts` (13): getOrCreate / remove / appendUserMessage / beginAssistantMessage / appendAssistantDelta / finalize（text あり / 空コンテンツ skip / tool_uses で bubble 作成）/ recordToolResult（注入 / isError / 不一致 noop）/ setActivity / setStatus / setSessionId / setError
  - `main/__tests__/claude-process-detector.test.ts` (10): 単 chunk 検出 / chunk 跨ぎ検出 / 同 paneId は 1 度のみ / paneId 別独立 / reset で再検出 / 別タイトルは検出せず / fallback BEL 直後パターン / window 未登録 noop / destroyed window スキップ / unregisterWindow で states クリア
- **既存テスト改訂**: `terminalMetaStore.test.ts` に mdTabs ベースの 9 ケース追加（hydrateMetas with mdTabFilePaths / openMarkdown 既存タブアクティブ化 / 上限到達 / closeMdTab フォールバック / setMdDirty / markMdSaved / canOpenMoreMd）、`markdownOpenService.test.ts` を新仕様に書き直し（dirty 警告削除）、`markdownDialogStore.test.ts` に `tabId` 必須化、`terminalStore.test.ts` のモックに `chat.dispose` 追加、`TerminalPane.test.tsx` の md 状態モックを `mdTabs` に置換
- **テスト合計**: 35 ファイル / 502 件グリーン（修正前 454 から +48 件）
- **計画書アーカイブ**: `.claude/archive/2026-04-29-claude-code-chat-ui.md` に Status=COMPLETED で移動済み
- **設計判断**:
  - **Chat バックエンドは別プロセス、PTY と並走**: PTY 上で claude が起動していても Chat 用の子プロセスは独立した session_id で動かす。プロセスリーク防止のため closeTerminal で `chat.dispose` を呼んで両方破棄。CLI ↔ Chat の会話継続は session_id を `--resume` で再投入する形にし、自動継続は PTY 状態破壊リスクを避けて明示クリック（「CLI で続きを表示」）に限定
  - **空 bubble 抑制**: claude が assistant ブロックを tool_use のみで返す場合、text と thinking が空のまま finalize される。空 bubble がストリーミング中に複数並ぶと焦ったいので、`finalizeAssistantMessage` で内容が完全に空なら message 化せず activity だけクリア。ただし toolUses が 1 件でもあれば bubble を作る（折りたたみカード表示のため）
  - **作業状態の表示は currentActivity ベース**: stream_event の `content_block_start` で `tool_use` / `thinking` / `text` を判別して activity に保存し、`content_block_stop` でクリア。ChatStatusBar が「Bash を実行中: <description>」「Claude が思考中...」「Claude が応答を生成中...」を切替表示する。ツール使用の inline カード（MessageBubble 内の ToolUseChip）と二重情報になるが、タイムラインを spam しない簡潔な進捗表示として併存
  - **MD タブの mount 戦略**: 全 mdTabs を mount し続けて active 以外を display:none で隠す。CodeMirror の internal state（カーソル位置・履歴・編集中の差分）をタブ切替で保持するため。`tab.id + tab.loadedAt` を React key に使うことで、同一タブの再ロード時にだけ remount
  - **「+ ボタン」のドロップダウンを Portal で配置**: タブ列内に絶対配置すると overflow:auto に切られるので、`createPortal(document.body)` で z-index 10000 で描画。anchor の bounding rect で位置決めし、viewport 端で右にはみ出る場合は左寄せ
  - **「CLI で続きを表示」の自動 vs 明示**: PTY が現在シェルプロンプトに居ない場合（コマンド実行中など）に `claude --resume` を流すと混入する。Chat → CLI 切替を全自動 resume にすると体験が壊れるリスクがあるため、ユーザーが意図的にクリックする「CLI で続きを表示」ボタンに限定。通常の「CLI に戻る」ボタンは PTY を触らない
  - **OSC 0 検出の fallback 設計**: `\x1b]0;✳ Claude Code\x07` (絵文字付きの完全マッチ) を primary、`]0;` + `Claude Code\x07` (BEL 直後) の同居を fallback。BEL 直後を要求することで「他の出力に偶然 Claude Code が含まれる」誤検出を回避

### 2026-04-29 - T3-5（候補） Claude Code Chat UI 計画策定

#### 概要

ユーザーが `claude` CLI を起動した際に claude.ai 風の専用チャット UI に切替できる機能（T3-5 候補）の計画書を策定。Anthropic API 直接呼び出しは使わず、サブスクリプション認証付きの既存 `claude` CLI を子プロセス起動して `--output-format stream-json --input-format stream-json` で双方向 JSONL を流す方針。既存 T2-8（Markdown Editor）と同じ per-pane viewMode 拡張パターンを踏襲（`viewMode = "cli" | "md" | "chat"`）。Open Questions Q1〜Q5 をユーザーと確定: (Q1) 自動検出、(Q2) CLI ↔ Chat 切替で会話継続（`--resume <session-id>` 連携）、(Q3) stream-json 仕様は Phase 0 で実機検証、(Q4) MVP ではツール使用イベント表示なし（Phase 4 で再判断）、(Q5) 入力欄は 1〜3 行自動拡張・4 行以上で内部スクロール、上限 64KB 目安。Phase 0（事前検証） / Phase 1（IPC + Main） / Phase 2（Renderer State） / Phase 3（UI + UX 評価セッション）/ Phase 4（統合・ガード・suppress オプション・必要なら ToolUseCard）/ Phase 5（ドキュメント反映）の 6 フェーズで構成。

#### 変更点

- **新規プラン**: `.claude/2026-04-29-claude-code-chat-ui.md`（Status: APPROVED — Phase 0 着手待ち）
  - Architecture: `chat-session-manager.ts`（spawn / `--resume` / write / stop / dispose / getSessionId）、`claude-process-detector.ts`（PTY 出力監視 + foreground プロセス確認 500ms ポーリング）、stream-json パーサ、IPC（`chat:start` / `chat:send` / `chat:stop` / `chat:dispose` / `chat:getSessionId` / `chat:event` / `chat:claudeDetected`）、Renderer Store（`chatSessionStore` + `viewMode` 拡張）、UI（`ChatPaneView` / `MessageList` / `MessageBubble` / `ChatInput` / `ChatStatusBar`、ToolUseCard は MVP 範囲外）
  - Phase 0 検証項目: stream-json 双方向ストリーミング / `--resume` 挙動 / session-id 取得経路 / 自動検出方式（claude 固有 ANSI/OSC の有無 + `tcgetpgrp` + `ps` の妥当性）/ ツール承認イベント / 認証エラー
  - 設計判断: claude CLI ラップで認証は CLI 側 OAuth に委譲（API キーを持たない）、PTY と Chat は viewMode 切替で並存（PTY 破棄しない）、CLI ↔ Chat は同一 session-id で `--resume` 継続、自動検出は MVP では即時切替（モーダルなし、suppress は Phase 4）、入力欄は 4 行スクロールとパフォーマンス計測ベースの 64KB 上限
  - Files テーブル: 新規 14 + modify 9（ToolUseCard は Phase 4 に明示）
  - Verification: 機能受入 12 項目（自動切替 / 会話継続 / ストリーミング / IME 誤送信防止 / プロセスリーク無し / 64KB + 100 件メッセージのパフォーマンス受入）
- **MEMORY.md（予定）**: T3-5（候補） Claude Code Chat UI in Pane を追加（計画書リンク + Phase 0 着手待ちの注記）

> 2026-05-02 ローリングアーカイブ: 「T2-10 カスタマイズ拡張（フォント / カーソル / シェル / エディタ / 通知）」「ターミナル MD パスのクリック起動 + 新規ペイン作成オプション + ペイン番号フォント調整」を [`HISTORY-archive.md`](./HISTORY-archive.md) に移動済み。

#### 変更点

- **shared/settings.ts**: `TerminalSettings` / `EditorSettings` / `GeneralSettings` を新規追加。フィールド単位の `validateTerminalSettings` / `validateEditorSettings` / `validateGeneralSettings` と、`mergeSettings` の field-level merge（`base.terminal` を spread して patch をマージ）。クランプ定数 `FONT_SIZE_MIN/MAX` (8/32) / `LINE_HEIGHT_MIN/MAX` (1.0/2.0) / `SCROLLBACK_MIN/MAX` (1000/100000) / `EDITOR_FONT_SIZE_MIN/MAX` (10/32) を export。`clampNumber` ヘルパも export して renderer 側で再利用
- **renderer/stores/settingsStore.ts**: `applyOptimistic` を `terminal` / `editor` / `general` の浅マージ対応に拡張。`useTerminalSettings` / `useEditorSettings` / `useGeneralSettings` セレクタを追加
- **renderer/stores/terminalMetaStore.ts**: `fontSizeOverride: number | null` と `customTitle: string | null` を `TerminalMeta` に追加（揮発、session-persist 対象外）。`setFontSizeOverride(id, value)` / `setCustomTitle(id, value)` action を追加。`initMeta` / `initLeafMeta` / `hydrateMetas` の初期値はすべて null
- **renderer/services/terminalManager.ts**: `applyOptions(id, partial: Partial<ITerminalOptions>)` を新規追加。セルサイズ影響キー（`fontSize` / `fontFamily` / `fontWeight` / `fontWeightBold` / `letterSpacing` / `lineHeight`）の変更時は `invalidateLastSize` + `fit()` で PTY 側にもリサイズを伝える。`subscribeBell(id, listener)` を追加（戻り値で unsubscribe）
- **renderer/components/TerminalPane.tsx**: ハードコードされていた fontSize=13 / fontFamily / lineHeight=1.2 / cursorBlink / cursorStyle / scrollback=10000 をすべて `useTerminalSettings()` 由来に置換。`fontSizeOverride` を購読して `effectiveFontSize = override ?? settings.fontSize` を計算（クランプ付き）。設定変更を購読して `applyOptions` で即時反映する `useEffect` を追加（フォントサイズ変動時は `pty.resize` も発火）。Bell 購読 `useEffect` で visual flash（120ms）/ sound（WebAudio 880Hz 80ms）を実装。`pty.create` 呼び出しに `options: { shell, defaultCwd }` を追加。`onExit` ハンドラを `(exitCode) => void` に拡張し、`general.ptyExitNotification && exitCode !== 0` のとき `Notification` API で macOS 通知
- **renderer/shortcuts/registry.ts**: `font-zoom-in` (Cmd+=) / `font-zoom-out` (Cmd+-) / `font-zoom-reset` (Cmd+0) の 3 ID を追加。`ShortcutCategory` に `Font` を追加（リバインド可能、settings UI のショートカットタブから上書き可能）
- **renderer/App.tsx**: `adjustActivePaneFontSize(paneId, delta)` ヘルパを追加（`getState()` でフレッシュ参照、クランプ付き、no-op early return）。3 ショートカットの handlers を追加。`useSettingsStore.getState().settings.terminal` から起点を読み、`useTerminalMetaStore.getState().setFontSizeOverride()` で per-pane delta を更新
- **renderer/services/terminalManager.ts (TerminalCallbacks)**: `onExit: () => void` → `onExit: (exitCode: number) => void` にシグネチャ拡張（main からの exitCode をパススルー）
- **main/pty-manager.ts (createPty 拡張)**: `customShell?: string` 引数を追加。`fs.existsSync(customShell)` で実在チェックし、不在なら `process.env.SHELL || "/bin/zsh"` にフォールバック
- **main/ipc-handlers.ts (pty:create シグネチャ拡張)**: `options?: { shell?, defaultCwd? }` を受領。`defaultCwd` は `initialCwd` 未指定時のフォールバックとして `validatePath` を通してから `createPty` に渡す
- **preload/index.ts**: `pty.create(id, initialCwd?, options?)` の型拡張
- **renderer/main.tsx (bootstrap)**: 起動時に `settings.get()` と `session.getRestoreData()` を `Promise.all` で並列取得し、`general.restoreSessionOnLaunch` が false なら復元をスキップ（並列化で起動時間影響を最小化）
- **新規 UI: settings/TerminalSettings.tsx**: フォントサイズ slider（範囲 8–32）+ ファミリー preset セレクト（6 種）+ カスタム指定 input + 行間 slider（1.0–2.0）。カーソルスタイル select（block/underline/bar）+ 点滅 toggle。スクロールバック slider（1000–100000、step 1000）+ Bell select + 単語区切り input。デフォルトシェル input + デフォルト CWD input + 「参照」ボタン（`dialog.selectDirectory` を呼ぶ）
- **新規 UI: settings/EditorSettings.tsx**: フォントサイズ slider（10–32、step 0.5）+ ファミリー preset（5 種、比例フォント中心）+ カスタム指定 + softWrap toggle
- **新規 UI: settings/GeneralSettings.tsx**: セッション復元 toggle + PTY 異常終了通知 toggle（初回 ON 時に `Notification.requestPermission` を自動要求）
- **renderer/components/SettingsModal.tsx**: タブを 3 個から 6 個に拡張（外観 / ターミナル / エディタ / ショートカット / ウィンドウ / 一般）
- **renderer/components/TerminalSubHeader.tsx**: ペイン名表示にダブルクリック inline rename を追加。`customTitle` が null なら CWD 由来の `folderName` を表示、文字列なら優先表示。空文字列確定で null に戻して自動表示へ復帰。Enter / blur で確定、Escape でキャンセル
- **renderer/components/MarkdownEditor.tsx**: `useEditorSettings()` 購読を追加。`fontSize: "13.5px"` ハードコードを `editorSettings.fontSize` 由来に、`fontFamily` ハードコードを `editorSettings.fontFamily` に置換。extensions 配列に `editorSettings.softWrap ? [EditorView.lineWrapping] : []` を spread で追加
- **新規テスト 20 件**:
  - `shared/__tests__/settings.test.ts` (+6): terminal/editor/general の merge と clamp、cursorStyle/bellStyle の不正値 fallback、validateAppSettings の terminal block 不正値復元
  - `renderer/stores/__tests__/terminalMetaStore.test.ts` (新規 10 件): initMeta の null 初期化 / 既存 meta の上書き禁止 / setFontSizeOverride（更新・null リセット・no-op・他ペイン無干渉）/ setCustomTitle（文字列 / null クリア / 不在 id）/ hydrateMetas の null 初期化
  - `renderer/services/__tests__/terminalManager.test.ts` (+4): applyOptions の非サイズキーで no fit / サイズキーで refit / undefined 無視 / 未知 id no-op
- **既存テスト更新**: `TerminalPane.test.tsx` の `pty.create` 呼び出しアサーションに第 3 引数 `{ shell: undefined, defaultCwd: undefined }` を追加。`vi.mock` で `useTerminalMetaStore` を関数として callable に拡張（`fontSizeOverride` selector 用）、`useTerminalSettings` / `useEditorSettings` / `useGeneralSettings` の mock を追加（DEFAULT_SETTINGS から返す）。`settings.test.ts` の base AppSettings に terminal/editor/general を spread で含めるように修正
- **テスト合計**: 29 ファイル / 416 件グリーン（修正前 396 から +20 件）
- **CLAUDE.md (§8 Feature Tier Map)**: T2-10 を新規追加し、ターミナル / エディタ / 一般タブの構成、フォントズームの per-pane 揮発オーバーライド、ペインタイトル rename の自動復帰仕様を記載
- **設計判断**:
  - **フォントズームのスコープ C（グローバル + 揮発オーバーライド）**: iTerm2 のメンタルモデルを踏襲。グローバル設定を「新規ペインの初期値」とし、`Cmd+=` / `Cmd+-` でアクティブペインだけ独立調整、`Cmd+0` でグローバルへ戻る。VSCode のような全体共通だけだと「このペインだけ拡大したい」用途に応えられない。per-pane delta は session-persist 対象外（揮発）にすることで、再起動後はフレッシュなグローバル既定で始まる
  - **Cmd+= / Cmd+- / Cmd+0 のキーバインド**: VSCode / iTerm2 / Chrome 等と互換の事実上の業界標準。`registry.ts` に登録することで、ユーザーが `ShortcutSettings` から自由にリバインド可能（例: `Cmd+Shift+=` を好む人のため）
  - **per-pane delta は terminalMetaStore に揮発で持つ**: グローバル設定と同列に永続化すると、ペインを閉じても override 値がストレージに残ってしまい「テストで一度大きくしたまま忘れる」が起きやすい。揮発にすれば session を一旦終わらせれば自然にリセットされる
  - **applyOptions のサイズ影響キー判定 + 自動 refit**: xterm の `options.fontSize` を直接書き換えるとセル幅が変わり PTY の cols/rows が乖離する。`applyOptions` 内で `SIZE_AFFECTING` セットを参照し、該当キーが含まれていれば `invalidateLastSize` → `fit()` を実行して PTY 側にも `pty.resize` を送る（呼び出し側は戻り値の cols/rows で resize する）。これによりフォント変更時の表示崩れを 1 関数で完結
  - **Bell の WebAudio 実装**: ライブラリ依存ゼロ、880Hz 80ms の短ビープを `OscillatorNode` + `GainNode` で生成。`onended` で `AudioContext.close()` してリソース解放。OS の `NSBeep` を使う案もあったが、IPC 経由になるしユーザーが音量調整できないため WebAudio を選択
  - **Bell の visual flash は 120ms で十分**: もっと長くすると入力中に視認性が落ちる。フラッシュは「気づき」の発火点だけ提供し、ユーザーが実際に確認するのは ALT screen やプロンプトで行う前提
  - **PTY 終了通知は Renderer 側の `Notification` API**: main → IPC で `Notification` を出す案もあったが、Renderer 内で完結したほうが (a) ペイン情報（customTitle / processName / cwd）に直接アクセスでき、(b) 許可ダイアログの UX を制御しやすい。`general.ptyExitNotification` トグルで初回 ON 時に `requestPermission()` を発火するため、ユーザーは設定で許可をコントロールできる
  - **PTY 異常終了の判定は exitCode !== 0**: 0 を「正常終了（exit / Ctrl+D）」、非 0 を「異常終了（クラッシュ / 強制 kill）」として macOS 通知の対象にする。Bell とは別軸のため両方有効化しても重複しない
  - **デフォルトシェルの存在チェック + フォールバック**: ユーザーが間違ったパス（例: `/usr/local/bin/fish` だが未インストール）を入れても黒画面で起動失敗にならないよう、`fs.existsSync` で実在チェックし不在なら `$SHELL || /bin/zsh` にフォールバック。pty-manager 側の安全網
  - **デフォルト CWD の優先順位**: 旧来の「メタストア（分割時 CWD）> windowInitialCwd（Dock）> $HOME」の最後に `settings.terminal.defaultCwd` を入れる、ではなく **`initialCwd` が空のときの fallback として ipc-handlers で適用**。これにより Dock や分割からの明示的な CWD は常に優先され、設定の defaultCwd は「何も指定されないとき」だけ効く
  - **セッション復元 ON/OFF を bootstrap で並列読み**: `settings.get()` と `session.getRestoreData()` を逐次にすると起動時間が IPC 2 回分のレイテンシ。`Promise.all` で並列化することで影響を最小化、settings false なら復元データを単に捨てるだけ（拒否する場合の destroy は `session.clear()` を呼ばない — ユーザーが設定を戻せば次回また復元できる）
  - **ペインタイトル rename は customTitle null で自動復帰**: 「rename を解除したい」UX を別ボタンで実装するとサブヘッダーが煩雑になる。空文字列を確定すれば null に戻す扱いにすることで、操作系列が「ダブルクリック → 全消去 → Enter」の 1 フローで完結
  - **MarkdownEditor の softWrap は EditorView.lineWrapping で extension 切替**: CodeMirror 6 の標準パターン。`useMemo` の dep に `editorSettings.softWrap` を含めることで、設定切替時に extensions 配列が再生成され CodeMirror 側が新しい extension を有効化する
  - **EditorSettings のフォントプリセットは比例フォント中心**: ターミナルと違い Markdown は文章中心の用途が多いため、Helvetica / Hiragino / システム既定の sans-serif を上に置き、等幅は下位に。ユーザーが「コード片中心の note を書く」用途では Menlo / JetBrains Mono を選べるようカスタム指定 input も併設
  - **設定タブの並び**: 外観 / ターミナル / エディタ / ショートカット / ウィンドウ / 一般。「外観」を最上位に保つことでテーマ切替の発見可能性を維持し、「ターミナル」を 2 番目に置くことで本アプリの主用途に直結する。「一般」は最下位に置いて「設定全体に影響する大物」を物理的に区別
- **計画書アーカイブ**: `.claude/archive/2026-04-29-customization-features.md` に Status=COMPLETED で移動済み

> 2026-04-29 ローリングアーカイブ: 「サイドバー再帰検索 + 検索フィールド内ショートカット passthrough」「Settings カラー編集の簡略化（セマンティック 6 色化）」、「Markdown エディタ dark モード背景修正」「サイドバーファイル名アイコンずれ修正」、および 2026-04-26 の 2 エントリを [`HISTORY-archive.md`](./HISTORY-archive.md) に移動済み。

> 2026-04-27 ローリングアーカイブ: これ以前の 30 エントリは [`HISTORY-archive.md`](./HISTORY-archive.md) に移動済み。
