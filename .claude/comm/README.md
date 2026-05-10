# Comm Protocol — 複数 Claude チャット間のファイル経由通信

複数の Claude チャットセッションが、ファイルを介して非同期にやり取りするための最小プロトコル。Phase 1（Outbox のみ）の試作版。

## このプロトコルの目的

身近な比喩で言うと、**冷蔵庫に貼った付箋でやり取りする家族**のようなものです。リアルタイム会話ではなく、書き置きを介して非同期に情報を共有する。

- 別チャットで進めている作業の状況を確認できる
- 別チャットに「これお願い」を残して、次に開いたとき気付いてもらえる
- メインチャットが context を消費せずに、他チャットの動向を把握できる

## ファイル構造

```
.claude/comm/
├── README.md                  # このファイル（プロトコル定義）
├── outbox/
│   ├── chat-<name>.md         # 各チャットの発信箱（書くのは本人のみ、読むのは全員）
│   └── ...
└── archive/
    └── YYYY-MM/               # 古くなった発言をここに退避
        └── chat-<name>.md
```

## 中核ルール: 単一書き込み者

**Outbox は 1 ファイル 1 チャット専用**。これがこのプロトコルの心臓部。

| ファイル               | 書き込んでよい人   | 読んでよい人 |
| ---------------------- | ------------------ | ------------ |
| `outbox/chat-alice.md` | Alice チャットだけ | 全チャット   |
| `outbox/chat-bob.md`   | Bob チャットだけ   | 全チャット   |

身近な比喩で言うと、**各自の日記帳**です。他人の日記には書き込まない、でも借りて読むのは OK。これで同時編集衝突が**設計レベルで起きえない**構造になります。

## チャット名の決め方

Claude は自動でチャット名を生成しないので、**ユーザーが手動で命名**する必要があります。

命名規則の例:

- 役割ベース: `chat-pm`, `chat-engineer`, `chat-qa`
- ブランチベース: `chat-main`, `chat-feat-auth`, `chat-fix-bug-123`
- セッション開始日時: `chat-2026-05-10-1430`

セッション開始時にユーザーが「このチャットは `chat-engineer` で行く」と宣言する運用が一番シンプルです。

## Outbox のフォーマット

各 Outbox は append-only の時系列ログ。**過去のエントリは編集しない**（追記のみ）。

```markdown
# chat-<name> outbox

このチャットだけが書き込み可能。他チャットは読み取り専用。
最新エントリを上に追記する（降順）。

---

## YYYY-MM-DD HH:MM → @<recipient>

<body>

---

## YYYY-MM-DD HH:MM → @<recipient>

<body>
```

### 宛先タグの使い分け

- `@all` — 全チャット宛（broadcast）
- `@<chat-name>` — 特定チャット宛（unicast）
- `@self` — 自分への備忘録（private note。他チャットも読めるが宛先ではない）

### エントリの書き方の例

```markdown
## 2026-05-10 14:32 → @chat-qa

migration 0042 の実装が終わったのでレビューお願い。

- 対象: src/migrations/0042_user_schema.sql
- 論点: 50M 行テーブルへの NOT NULL 追加
- 検証済み: ローカルテスト PASS
- 不安点: 本番 DB の lock contention
```

```markdown
## 2026-05-10 15:01 → @all

`feat/auth` ブランチ切りました。auth 周り触る人は main から rebase してから作業してください。
```

## 衝突対策（4 層防御）

| 層        | 対策                                       | 効果                             |
| --------- | ------------------------------------------ | -------------------------------- |
| 1. 設計   | Outbox は単一書き込み者                    | 衝突が起きえない                 |
| 2. 構造   | append-only, 降順追記                      | 衝突しても損失は新規 1 行に限定  |
| 3. ロック | 共有状態はロック取得経由（Phase 4 で導入） | Phase 1 では使わない             |
| 4. git    | `.claude/comm/` を git 管理                | 衝突しても commit 履歴で復元可能 |

Phase 1 では 1, 2, 4 のみで運用します。3（ロック）は将来 Inbox / Shared State を導入する段階で。

## 運用フロー

### 1. セッション開始時

```
1. ユーザーがチャット名を宣言（例: 「このチャットは chat-engineer」）
2. Claude が outbox/chat-engineer.md の存在を確認
   - なければ作成
3. 他チャットの outbox（outbox/chat-*.md 全て）を確認
   - 自分宛のメッセージがないか grep
   - 「@chat-engineer」「@all」を含む最新エントリを読む
```

### 2. 作業中に他チャットへ通知したいとき

```
1. ユーザーが「QA に migration 0042 のレビュー頼んで」と指示
2. Claude が outbox/chat-engineer.md の先頭にエントリを追記
   - timestamp、@chat-qa、本文
3. ユーザーが QA チャット側で「inbox 確認して」と指示
   - QA チャットの Claude が outbox/chat-engineer.md を読む
   - 自分宛のメッセージを認識
```

### 3. セッション終了時

特別な処理は不要。Outbox は永続的に残る。

## 重要な制約: Claude はファイルを監視できない

**最重要の落とし穴**。Claude Code には**ファイル監視機能がない**ので、誰かが Outbox に書いても、もう片方の Claude は**自動では気付きません**。

身近な比喩で言うと、**ポストに手紙を入れても、相手がポストを開けに行かないと届かない**のと同じ。

確認方法は 4 種類:

| 方法                                                 | 手間 | 確実性 |
| ---------------------------------------------------- | ---- | ------ |
| ユーザーが「他チャットの outbox 確認して」と毎回言う | 中   | 高     |
| SessionStart hook で自動 cat（Phase 2 で導入予定）   | 低   | 高     |
| `/loop` スキルで定期チェック                         | 中   | 中     |
| 何もしない（手動で読みたいときだけ）                 | 低   | 低     |

**Phase 1 では「ユーザーが指示したときに読む」が基本**です。

## アーカイブ運用

Outbox が肥大化したら（目安: 100 エントリ超 or 1 ヶ月経過）、`archive/YYYY-MM/` に退避:

```bash
mkdir -p .claude/comm/archive/2026-05
mv .claude/comm/outbox/chat-engineer.md .claude/comm/archive/2026-05/
# 新しい outbox ファイルを作り直す
```

## アンチパターン

- ❌ 他チャットの outbox を編集する（衝突が起きる）
- ❌ Outbox の過去エントリを書き換える（履歴破壊）
- ❌ Outbox に大量の生データ（コード全体・ログ全文）を貼る（context 爆発）
- ❌ `@all` を多用する（ノイズ）
- ❌ チャット名を被らせる（ファイルが衝突する）
- ❌ 名前なしチャットで運用する（誰の発言か分からなくなる）

## このテンプレートのインストール

新しいプロジェクトで使うとき:

```bash
cp -r ~/.claude/templates/comm-protocol <project-root>/.claude/comm
```

その後、プロジェクトの `CLAUDE.md` に以下を追記すると、Claude が起動時に自動でプロトコルを認識します:

```markdown
## 並行チャット間通信

このプロジェクトは `.claude/comm/` 経由でチャット間通信を行う。
プロトコルは `.claude/comm/README.md` 参照。
セッション開始時にチャット名（chat-<name>）を宣言してから作業を始める。
```

## 将来の拡張（Phase 2 以降）

- **Phase 2**: SessionStart hook で他 outbox を自動 cat
- **Phase 3**: 共有 Inbox（append-only ログ）追加
- **Phase 4**: Shared State + ロック機構（multi-session-coordinator と統合）

Phase 1 を運用してみて不便を感じたら次フェーズへ。
