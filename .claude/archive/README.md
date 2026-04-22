# Archive

完了済みの実装プラン（`.claude/YYYY-MM-DD-<slug>.md` として起票されていたもの）を保管する。

## 運用ルール

- プランが実装完了した時点で、ファイル内の `Status` を `COMPLETED` に更新
- ファイルを `.claude/` 直下から `.claude/archive/` に移動
- HISTORY.md に完了エントリを追加
- 実装規約として残すべき決定事項は `CLAUDE.md` §6-7 に統合、設計判断の「なぜ」は `docs/vision/coding-principles.md` に残す

## 参照方針

- 本ディレクトリは参照のみ。archive されたプランを直接編集しない
- 類似機能のリリース時に参考として grep する
- Known Issue 発生時、過去プランで触れた領域を確認するために使う
