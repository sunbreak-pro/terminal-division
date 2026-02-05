# パッケージ化後の日本語入力文字化け - 解決策

## 問題

`npm run dev` では正常に動作する日本語入力が、パッケージ化後のアプリでのみ IME 確定時に文字化けする。

## 原因

1. **node-pty の encoding オプション未設定**: デフォルトのエンコーディングがパッケージ化後に異なる動作をする
2. **環境変数（LANG, LC_ALL）の未設定**: 開発環境ではホストの環境変数が引き継がれるが、パッケージ化後は引き継がれない
3. **electron-builder の LSEnvironment 未設定**: macOS アプリ起動時のロケール環境変数が設定されていない

## 解決策

### 1. pty-manager.ts の修正

`src/main/pty-manager.ts` の `pty.spawn()` に以下を追加:

```typescript
const ptyProcess = pty.spawn(shell, [], {
  encoding: 'utf8',  // 追加: UTF-8エンコーディングを明示
  name: 'xterm-256color',
  cols: 80,
  rows: 24,
  cwd: homeDir,
  env: {
    ...process.env,
    LANG: 'ja_JP.UTF-8',      // 追加: 日本語ロケール
    LC_ALL: 'ja_JP.UTF-8',    // 追加: 全カテゴリのロケール
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor'
  } as { [key: string]: string }
})
```

### 2. electron-builder.yml の作成

プロジェクトルートに `electron-builder.yml` を作成:

```yaml
appId: com.terminal-division.app
productName: Terminal Division

mac:
  target:
    - dmg
  icon: resources/icon.icns
  extendInfo:
    LSEnvironment:
      LANG: ja_JP.UTF-8
      LC_ALL: ja_JP.UTF-8

win:
  target:
    - nsis
```

### 3. package.json の build セクション削除

`electron-builder.yml` に設定を移行したため、`package.json` の重複する `build` セクションを削除。

## 技術的な詳細

| 設定項目 | 役割 |
|---------|------|
| `encoding: 'utf8'` | node-pty がデータを UTF-8 として処理 |
| `LANG` | シェルのデフォルトロケール |
| `LC_ALL` | すべてのロケールカテゴリを上書き |
| `LSEnvironment` | macOS アプリ起動時の環境変数 |

## 注意事項

- `encoding: 'utf8'` は node-pty v0.9.0 以降で利用可能
- LANG/LC_ALL を `ja_JP.UTF-8` に固定しているため、日本語環境専用

## 検証済み

- ひらがな入力 → 確定 ✓
- カタカナ変換 → 確定 ✓
- 漢字変換 → 確定 ✓
- 長文入力 → 確定 ✓

## 解決日

2026-02-04
