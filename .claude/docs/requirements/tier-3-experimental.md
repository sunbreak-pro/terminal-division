# Tier 3 — 実験 / 凍結候補

未着手、または意図的に凍結している候補機能。Non-Goals に近いものは `docs/vision/core.md` に記載。

---

## T3-1: タブ機能

### Purpose

1 ウィンドウに複数のペインセットを持てるようにする。

### Verdict

**未定**（要望ヒアリング待ち）

### Boundary（仮）

- **含む候補**: `Cmd+T` で新規タブ、タブバー表示、タブ間ショートカット切替
- **含まない**: タブ並び替えの自動保存

### 判断材料

- 現状 `MAX_TERMINALS = 6` で 1 ウィンドウ完結。タブを足すと 12 ペイン相当になり UX が過密化する懸念
- 代替案: Dock メニューから新ウィンドウを開く運用で十分か再評価

### Dependencies

- 上位に新しいコンテナ構造が必要（二分木の root の上にタブリスト）

---

## T3-2: プロファイル / テーマ管理

### Purpose

ユーザーが複数テーマ・フォント設定を切り替えられるようにする。

### Verdict

**凍結**

### 凍結理由

- Value Proposition は「軽量な iTerm2 スタイル分割」。プロファイル機能は iTerm2 との競合軸でもメリットが小さい
- `vision/core.md` の Non-Goals に該当

### 再開トリガー

- 明確なユーザー要望が複数届いた場合のみ再評価

---

## T3-3: シェル統合機能（コマンド実行状態の追跡）

### Purpose

OSC 133（FTCS: Final Term 互換）等でプロンプト・コマンド境界を検出し、UI にコマンド実行時間や終了ステータスを表示する。

### Verdict

**候補**（OSC 7 による CWD 追跡が既にある。OSC 133 への拡張は中規模の改修）

### Boundary（仮）

- **含む候補**: プロンプト境界マーカー、コマンド実行時間、終了ステータスのインジケータ
- **含まない**: シェル設定ファイルの自動書き換え

### Dependencies

- `terminalManager.ts` の OSC ハンドラ拡張
- シェル側の統合設定（ユーザーが `~/.zshrc` 等を設定する前提）

---

## T3-4: テスト環境の整備強化

### Purpose

現状 Vitest と `@testing-library/react` が導入済みだが、テスト文化が未整備。E2E / スナップショット / プロセス境界テストを補強する。

### Verdict

**必要時に随時追加**

### Boundary

- **含む**: 現状 `vitest run` で動く単体テスト（store / manager / PTY / パネルコンポーネント）
- **含まない**: E2E フレームワーク（Playwright 等）の本格導入は未決定

### 判断材料

- `No test runner is configured` と以前の CLAUDE.md には書かれていたが、実際は `vitest` が package.json に存在し HISTORY でテスト修正作業も実施されている
- 今後: `npm test` の運用ルール（CI での扱い）を requirements 側で明文化する
