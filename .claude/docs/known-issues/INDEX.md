# Known Issues INDEX

壊れている／壊れていた箇所の Root Cause と再発防止知見を管理するディレクトリの索引。

類似バグに遭遇したときはまず本 INDEX を grep / スキャンする。

## Active

<!-- 未解決の Issue を記載。Status=Active -->

（なし）

## Monitoring

<!-- すぐ対処しないが将来の落とし穴になりうる構造的問題。Status=Monitoring -->

（なし）

## Withdrawn

<!-- 関連機能ごと撤回された Issue。参照のため archive/ に保管。 -->

| #                                              | タイトル                                             | Withdrawn  | 備考                                                                                              |
| ---------------------------------------------- | ---------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------- |
| [003](./archive/003-claude-cli-stream-json.md) | Claude CLI stream-json プロトコル仕様 (Phase 0 検証) | 2026-05-02 | T3-5 Chat UI 機能ごと撤回（subscription redistribution risk）。復活時の参照用に archive/ で保管。 |

## Fixed

| #                                             | タイトル                                          | Resolved   | キーワード                                                                       |
| --------------------------------------------- | ------------------------------------------------- | ---------- | -------------------------------------------------------------------------------- |
| [001](./001-packaged-app-japanese-garbled.md) | パッケージ化後の日本語入力文字化け                | 2026-02-04 | node-pty encoding, LANG/LC_ALL, LSEnvironment, macOS パッケージ                  |
| [002](./002-scrollback-cols-mismatch.md)      | Scrollback の cols 不整合（過去行が極狭幅で固定） | 2026-04-27 | xterm.js, fitAddon, pty.resize, ResizeObserver, react-resizable-panels, viewMode |

---

## 運用ルール

- 新規発見時: `NNN-<slug>.md` を `_TEMPLATE.md` ベースで作成、Status=Active、本 INDEX にも追記
- 対応着手: 必要なら `.claude/YYYY-MM-DD-<slug>.md` にプラン起票し、Issue ファイルから相互リンク
- 解決時: Issue ファイルの Status=Fixed、Resolved 日付 / 修正箇所 / Lessons Learned 追記、INDEX の Active → Fixed へ移動
- 連番は廃番後も再利用しない
- 類似バグの疑いが出たら INDEX のキーワードを grep で横断検索する
