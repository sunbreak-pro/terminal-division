# 001: パッケージ化後の日本語入力文字化け

**Status**: Fixed
**Discovered**: 2026-02-04
**Resolved**: 2026-02-04
**Related**: `src/main/pty-manager.ts`, `electron-builder.yml`

---

## Symptoms

`npm run dev`（開発環境）では正常に動作する日本語入力が、パッケージ化後のアプリでのみ文字化けを起こす。

### 再現手順

1. `npm run build:mac`（または `build:win`）でアプリをパッケージ化
2. パッケージ化されたアプリを起動
3. ターミナルで日本語を入力
4. Enter または IME で確定

### 観測される出力

```
�<008a>�<0097>��<0081>�
```

IME の変換確定時にも同様の文字化けが発生。英数字のみの入力では正常に動作。

---

## Root Cause

3 つの要因が重なって発生していた:

1. **node-pty の encoding オプション未設定**: デフォルトエンコーディングがパッケージ化後で異なる挙動を示す
2. **環境変数（LANG / LC_ALL）の未設定**: 開発環境ではホストの環境変数が引き継がれるが、パッケージ化後は引き継がれない
3. **electron-builder の `LSEnvironment` 未設定**: macOS アプリ起動時のロケール環境変数が設定されない

---

## Fix

### 1. `src/main/pty-manager.ts`

`pty.spawn()` に UTF-8 エンコーディングと日本語ロケールを明示:

```typescript
const ptyProcess = pty.spawn(shell, [], {
  encoding: "utf8",
  name: "xterm-256color",
  cols: 80,
  rows: 24,
  cwd: homeDir,
  env: {
    ...process.env,
    LANG: "ja_JP.UTF-8",
    LC_ALL: "ja_JP.UTF-8",
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
  } as { [key: string]: string },
});
```

### 2. `electron-builder.yml`（新規作成）

`LSEnvironment` でアプリ起動時のロケールを固定:

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

### 3. `package.json` の `build` セクション削除

設定を `electron-builder.yml` に集約するため重複削除。

### 検証

- ひらがな入力 → 確定 ✓
- カタカナ変換 → 確定 ✓
- 漢字変換 → 確定 ✓
- 長文入力 → 確定 ✓

---

## Lessons Learned

- **開発環境とパッケージ版で環境変数の引き継ぎ挙動が違う**: 開発時に検知できないバグの温床。重要な環境変数（`LANG`, `LC_ALL`, `PATH`）はパッケージ版で明示する
- **node-pty は `encoding` オプション必須**: デフォルト任せにしない
- **ロケール依存処理は `LSEnvironment` に固定**: macOS でのネイティブアプリ配布では必須
- 同種トラブル: Issue 002（PATH 解決のパッケージ版差異、HISTORY 2026-03-15 参照）

## References

- 関連ファイル: `src/main/pty-manager.ts`
- 関連設定: `electron-builder.yml`
- 関連 Known Issue: なし
- node-pty: https://github.com/microsoft/node-pty
