# Vision Core — Terminal Division

本プロジェクトの存在意義・ターゲット・価値提案・非目標を記述する。

> 詳細な実装規約は `CLAUDE.md`、機能単位の要件は `docs/requirements/` 参照。

---

## Core Identity

Terminal Division は、**macOS ネイティブで使える軽量な iTerm2 ライクなターミナル分割アプリ**である。
Electron + React + TypeScript + xterm.js + node-pty で構築され、ブラウザ UI の柔軟性とネイティブシェルのフル機能を両立する。

## Target User

- **Primary**: macOS で複数プロセスを同時に監視・操作したい開発者（ビルド監視 / ログ tail / 対話シェル並走）
- **Secondary**: iTerm2 の分割機能のみを軽量に使いたいユーザー、日本語入力が壊れないターミナルを探しているユーザー
- **Not target**: マルチプレクサ機能（tmux 置き換え）、SSH マネージャー、プロファイル豊富な高機能ターミナル

## Value Propositions

1. **直感的な iTerm2 スタイル分割**: `Cmd+D` / `Cmd+Shift+D` で即座に縦横分割、最大 6 ペイン、`react-resizable-panels` によるドラッグリサイズ
2. **日本語 IME の完全サポート**: xterm.js の textarea に compositionstart/end を直結し、中間状態の誤送信と二重送信を防止
3. **CWD 継承とネイティブ Dock 統合**: 分割時に元ペインの CWD を新ペインに継承、Dock メニューで最近のディレクトリから新ウィンドウを開ける
4. **パッケージ版でも壊れないシェル環境**: `$SHELL` 起動 + 多層フォールバック PATH 解決（path_helper / well-known paths / nvm 自動検出）

## Non-Goals

- **tmux / screen の代替**: セッション永続化、デタッチ/アタッチ、リモート共有は範疇外
- **クロスプラットフォームの第一級サポート**: Windows / Linux でビルドは通るが、UI / IME / ロケールは macOS 中心に最適化
- **プラグインエコシステム**: ユーザー拡張 API は提供しない（小さく保つ）
- **複雑なプロファイル・テーマ管理**: 単一テーマ、最小設定
- **7 ペイン以上**: `MAX_TERMINALS = 6` を設計制約として固定

## 将来の再評価トリガー

- macOS 以外のユーザー要望が継続的に届く → クロスプラットフォーム戦略を再検討
- ペイン数上限 6 を超える需要が顕在化 → レイアウトツリーのレンダリング性能を再評価
- tmux 的なセッション永続化要望 → 別プロジェクトで扱うか、本アプリでオプトインで実装するか判断

---

## 関連

- 機能 Tier 分類: [`docs/requirements/`](../requirements/README.md)
- 設計原則: [`docs/vision/coding-principles.md`](./coding-principles.md)
- 現状規約: [`CLAUDE.md`](../../CLAUDE.md)
