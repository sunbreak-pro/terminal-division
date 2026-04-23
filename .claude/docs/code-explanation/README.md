# Code Explanation

Terminal Division のコードベースを学習・理解するための教材。新規参加者や久しぶりに触れる際の入り口。

## 読む順序

前提知識なしで始める場合は `02` から。アーキテクチャ全体像を先に掴みたい場合は `01` から。

| #   | ファイル                                                     | 役割                                                      |
| --- | ------------------------------------------------------------ | --------------------------------------------------------- |
| 01  | [01-architecture-overview.md](./01-architecture-overview.md) | 3 プロセスモデル全体図・技術スタック・ファイル間依存      |
| 02  | [02-electron-basics.md](./02-electron-basics.md)             | Electron 基礎（前提知識なしで読める）                     |
| 03  | [03-data-flow.md](./03-data-flow.md)                         | ターミナル作成/入力/リサイズ/破棄の全データフロー（重点） |
| 04  | [04-layout-and-state.md](./04-layout-and-state.md)           | 二分木レイアウトと Zustand ストアの内部実装（重点）       |
| 05  | [05-advanced-features.md](./05-advanced-features.md)         | IME・ショートカットの実装詳細                             |

## 立ち位置

- **CLAUDE.md**: 現状規約の SSOT（何がどこにあるか、短く）
- **docs/code-explanation/**: 教材（なぜその実装か、長く、前提から説明）
- **docs/vision/**: 設計原則（なぜそう設計したか、長期的な指針）
- **docs/known-issues/**: 壊れた/壊れていた場所の Root Cause

コード変更に合わせた継続更新は任意。陳腐化した場合は CLAUDE.md または vision/ に要約を吸収させ、本ディレクトリを削除してよい。
