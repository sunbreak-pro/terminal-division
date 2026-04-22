# Requirements

機能要件定義を Tier 1-3 に分類して管理するディレクトリ。CLAUDE.md §8 Feature Tier Map の詳細版。

## Tier 分類の考え方

| Tier | 定義                                      | ファイル                                           |
| ---- | ----------------------------------------- | -------------------------------------------------- |
| 1    | コア — Value Proposition を直接支える機能 | [tier-1-core.md](./tier-1-core.md)                 |
| 2    | 補助 — あると価値が大幅増 / 体験向上機能  | [tier-2-supporting.md](./tier-2-supporting.md)     |
| 3    | 実験 / 凍結候補 — 未着手 or 凍結中の機能  | [tier-3-experimental.md](./tier-3-experimental.md) |

## 各機能エントリの記載項目

- **Purpose**: 何のためにあるか
- **Boundary**: どこまで含む / 含まない
- **Acceptance Criteria (AC)**: 完了条件（Tier 1 は 7-10 件推奨）
- **Dependencies**: 依存する他機能・モジュール
- **Verdict** (Tier 3 のみ): 実装する / 凍結継続 / 廃案

## ライフサイクル

- 新機能追加時は CLAUDE.md §8 に 1 行追加 + 該当 Tier ファイルに詳細記入
- Tier 変更時は両ファイル同期
- 廃案 → 該当エントリを削除 or Verdict=廃案 で保持
