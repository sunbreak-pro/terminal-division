# Coding Principles — Terminal Division

> 本プロジェクトの設計原則を集約する場所。過去の設計判断を統合し、現在から未来に向けた指針として保持する。
> 実装規約は CLAUDE.md §6-7 が正本。本ファイルは「なぜ」と「将来の判断材料」を残す。

---

## 1. React ライフサイクルから独立した Terminal Registry

### 規約

- xterm.js インスタンスと IPC リスナーは **モジュールスコープの `Map`**（`terminalManager.ts` の `registry`）で管理する
- `getOrCreate(id)` パターンで重複生成とリスナー多重登録を回避する
- React コンポーネント (`TerminalPane`) の `useEffect` クリーンアップでは `destroy()` を呼ばない。`destroy()` は `closeTerminal()`（Zustand）からのみ呼ぶ

### 背景

React StrictMode や Fast Refresh は `useEffect` を二重実行する。xterm.js インスタンスを React state やコンポーネントローカル変数で持つと、再レンダリングのたびに破棄と再生成が発生し、IPC リスナーの多重登録・入力履歴の消失・PTY の意図せぬ再生成を引き起こす。

モジュールスコープに退避することで:

- 安定した参照
- React に非依存なライフサイクル
- PTY プロセスと 1:1 対応する唯一のインスタンス

### 将来再評価のトリガー

- React が StrictMode の二重実行を撤廃した場合
- xterm.js が React バインディングを公式提供した場合

---

## 2. IPC 通信は最小限の API を contextBridge で公開

### 規約

- Preload の `contextBridge.exposeInMainWorld` で公開する API は必要最小限に限定
- `nodeIntegration: false` / `contextIsolation: true` を厳守
- 外部 URL オープンは `http://` / `https://` のみ許可する（`file://` 等はサニタイズ）
- Renderer から `require('fs')` 等の直接呼び出しを禁止

### 背景

Electron のセキュリティモデルに従い、XSS や依存モジュールの汚染があっても Node API への経路を絶つ。IPC チャネル数を少なく保つことで監査も容易になる。

### 将来再評価のトリガー

- 外部連携（プラグイン API 等）を検討する場合は、最低限 `contextBridge` の粒度を維持したまま設計し直す

---

## 3. レイアウトは「フラット Map + 二分木」で管理

### 規約

- `nodes: Map<string, LayoutNode>` にフラット格納し、親子関係は `parentId` / `children` で表現
- `TerminalPane`（葉）と `SplitNode`（内部）の 2 種のみ
- `rootId` でツリーのルートを追跡
- `MAX_TERMINALS = 6` を超える分割は `canSplit` で拒否

### 背景

- **任意ノードへの O(1) アクセス**: ネストされたオブジェクトだと特定ノード検索でツリー走査が必要
- **兄弟昇格ロジックの簡潔化**: ノード削除時に、親を削除して兄弟を祖父母に付け替える処理がフラット Map だと直接書ける
- **6 ペイン上限**: 画面面積・ヒューマンコグニティブ負荷の両面から妥当、パフォーマンス未最適化でも許容できる上限

### 将来再評価のトリガー

- 6 ペインを超える需要が顕在化した場合、仮想化描画（react-window 相当）を検討
- タブ機能を追加する場合は、上位に別のコンテナ構造を導入する

---

## 4. PTY エコーバック対策は「複層防御」で実装する

### 規約

- Undo/Redo 操作で PTY に送信したテキストは 3 層で除外する:
  1. `undoRedoInProgress` フラグ（期間中スキップ）
  2. `pendingSentText` による文字列一致（セーフティネット）
  3. 300ms タイマー（パッケージ版遅延対応）
- 連続操作ではタイマーを `clearTimeout` してリセットする
- 履歴更新を必要とする PTY 直接書き込み（Cmd+Backspace 等）は `terminalManager` 経由で履歴記録を伴って送信する

### 背景

PTY に書き込んだ文字はシェルからそのままエコーバックされる。ナイーブに実装すると `recordHistory()` がエコーバックを「新規入力」として記録し、履歴が壊れる。開発版では数 ms で返るエコーバックが、パッケージ版では IPC 経路延長で遅延するため、時間ベースのガードだけでは不十分。複層化する。

Known Issue 001（日本語文字化け）と 002（Cmd+Backspace Undo 欠落）で明らかになった罠。

### 将来再評価のトリガー

- シェル非依存のエコーバック検出（PTY 出力を diff する等）が実装できた場合は単純化できる

---

## 5. IME は xterm.js の textarea に直接フックする

### 規約

- `compositionstart` / `compositionend` を xterm.js 内部の textarea に直接 addEventListener する
- コンポジション中の非 ASCII 文字は `onData` でスキップする（ASCII 制御文字は処理）
- `compositionend` で送信したデータは `lastCompositionData` に記録し、xterm.js の `setTimeout(0)` 再 dispatch を dedup する

### 背景

xterm.js は ASCII 前提の設計。IME コンポジションと併用すると:

- 中間状態が `onData` で漏洩する
- `compositionend` 後に同じデータが `setTimeout(0)` で再送信される（二重送信）

xterm.js 本体にパッチを当てず、外側で dedup するのが最小侵襲。

### 将来再評価のトリガー

- xterm.js が公式に IME を一級サポートした場合は本処理を削除可能

---

## 6. パッケージ版のシェル環境は多層フォールバックで解決する

### 規約

- `$SHELL` → `/bin/zsh` のフォールバックでシェルを起動
- PATH 解決は 3 戦略を順次試行:
  1. `shell -lc 'printf %s "$PATH"'`（実シェルから取得）
  2. `/usr/libexec/path_helper -s`（シェル非依存）
  3. Well-known paths のファイルシステムプローブ（Homebrew / nvm / Volta / asdf / cargo / deno / bun）
- `HOME` / `USER` / `SHELL` / `LANG` が未設定なら補完する
- 日本語ロケール (`LANG=ja_JP.UTF-8` / `LC_ALL=ja_JP.UTF-8`) を PTY 環境に明示
- `electron-builder.yml` の `LSEnvironment` で macOS アプリ起動時のロケールを固定
- `npm_*` 環境変数は nvm 互換性のため削除

### 背景

Finder 起動のパッケージ版では、シェル設定ファイル・Homebrew・nvm が読み込まれず `npm` / `claude` / `brew` が軒並み見つからなくなる。また、日本語ロケールが引き継がれず node-pty 出力が文字化けする。Known Issue 001 の経緯を参照。

### 将来再評価のトリガー

- Electron が `LSEnvironment` 経由のロケール引き継ぎを不要にする API を追加した場合
- `nvm` が対話シェル非依存の API を標準化した場合

---

## 7. 大量データ（ペースト）はチャンク化 + bracket paste で安全に送る

### 規約

- 512 バイト以上のデータは `LARGE_PASTE_THRESHOLD` でチャンク分割
- 1024 バイト単位で 10ms 間隔で送信
- `\x1b[200~` / `\x1b[201~` で bracket paste モードを明示

### 背景

PTY / シェルが一度に大量データを受けると、改行ごとに逐次コマンド実行してしまう危険・バッファオーバーフローの危険がある。bracket paste で「ペースト」であることをシェルに伝え、チャンク化で送信圧を抑える。

### 将来再評価のトリガー

- node-pty がバックプレッシャー API を公式提供した場合

---

## 8. コメントは日本語、コード・識別子は英語

### 規約

- ソースコード中のコメントは日本語で書く
- 関数名・変数名・クラス名・コミットメッセージ・ブランチ名・PR タイトルは英語
- ユーザー向け文字列（メニュー / エラー / トースト等）は日本語を基本

### 背景

本プロジェクトの主要読者は日本語話者。コメントを日本語にすることで「なぜ」の情報密度を落とさずに済む。英語の識別子はライブラリ慣習と整合し、ツール（LSP / 検索）との親和性が高い。

### 将来再評価のトリガー

- 海外コントリビュータが恒常的に関わり始めた場合

---

## 9. 小さく保つ（Non-Goals の徹底）

### 規約

- プラグイン API を提供しない
- 複雑なプロファイル / テーマシステムを導入しない
- 7 ペイン以上のレイアウトを許可しない（`MAX_TERMINALS = 6`）
- tmux 機能を取り込まない
- 新機能提案は `docs/requirements/` で Tier 分類してから着手

### 背景

Value Proposition は「軽量な iTerm2 スタイル分割」。機能を増やすほど Electron アプリのバンドルサイズ・起動時間・メンテ負荷が増える。Non-Goals を明示して断ることがコア価値を守る。

### 将来再評価のトリガー

- 競合プロジェクト（iTerm2 / WezTerm / Warp）との差別化軸が揺らいだら Value Proposition から再検討する

---

## 設計原則の更新フロー

1. 新しい設計判断が必要 → 本ファイル該当章への追記 or 新章作成を検討
2. 実装規約になったもの → CLAUDE.md §6-7 に移す（本ファイルには「なぜ」を残す）
3. 将来の再評価トリガーを各章に明記
4. 廃案 / 却下された判断も残す（却下理由の記録が将来の再発防止になる）
