# パッケージ化後の日本語入力文字化けバグ

## 概要
`npm run dev`（開発環境）では正常に動作する日本語入力が、パッケージ化後のアプリでのみ文字化けを起こす問題。

---

## バグの詳細

### 再現手順
1. `npm run build:mac`（または`build:win`）でアプリをパッケージ化
2. パッケージ化されたアプリを起動
3. ターミナルで日本語を入力
4. Enterキーを押下、またはIMEで文字を確定

### 症状
- 入力した日本語が以下のような文字化け文字列に変換される:
  ```
  �<008a>�<0097>��<0081>�
  ```
- IMEの変換確定時にも同様の文字化けが発生
- 英数字のみの入力では正常に動作

### 環境差異
| 環境 | 状態 |
|------|------|
| `npm run dev` | ✅ 正常動作（案Cの修正適用済み） |
| パッケージ化後 | ❌ 文字化け発生 |

---

## 背景

### 先行修正: 日本語長文入力バグ（案C）
`terminalManager.ts`で以下の修正を適用済み:
- IME入力中の制御（`compositionstart`/`compositionend`イベント）
- 非ASCII文字（日本語など）の直接入力をスキップし、IME確定時のみ処理

この修正は開発環境では正常に機能しているが、パッケージ化後にのみ問題が発生。

---

## 調査ポイント

### 1. electron-builder のエンコーディング設定
- パッケージング時のロケール設定
- `asar`アーカイブ内でのエンコーディング処理
- `electron-builder.yml`または`package.json`の設定確認

### 2. node-pty のパッケージング問題
- ネイティブモジュールの再ビルド状況
- バイナリ互換性の問題
- `node-pty`のエンコーディング設定（`encoding: 'utf8'`の適用状況）

### 3. xterm.js の本番ビルドでの挙動差異
- 開発ビルドと本番ビルドでの`xterm-addon-*`の動作差異
- Unicodeハンドリングの違い

### 4. Electron の本番モードでの違い
- `app.isPackaged`による分岐処理の有無
- IPC通信でのエンコーディング
- プロセス間でのバイナリデータ受け渡し

### 5. シェル環境の違い
- パッケージ化後に渡される環境変数（`LANG`, `LC_ALL`）
- シェル起動時のロケール設定

---

## 関連ファイル

| ファイル | 役割 |
|---------|------|
| `src/renderer/src/services/terminalManager.ts` | ターミナル管理、IME制御、node-pty接続 |
| `src/main/index.ts` | メインプロセス、IPC設定 |
| `src/preload/index.ts` | プリロードスクリプト、IPC公開 |
| `package.json` | electron-builder設定 |
| `electron-builder.yml`（存在する場合） | パッケージング詳細設定 |

---

## 今後の調査方針

### 1. 環境変数の確認
パッケージ化後のアプリで実際に設定されている環境変数を確認:
```javascript
console.log(process.env.LANG, process.env.LC_ALL);
```

### 2. node-pty のエンコーディング明示
`pty.spawn()`のオプションで`encoding: 'utf8'`を明示的に指定:
```typescript
const pty = spawn(shell, [], {
  encoding: 'utf8',
  // ...他のオプション
});
```

### 3. IPC通信のデバッグ
メインプロセス⇔レンダラー間でのデータ受け渡しをログ出力し、どの段階で文字化けが発生するか特定。

### 4. electron-builder 設定の見直し
- `extraResources`や`files`設定
- macOS向け`LSEnvironment`でのロケール設定

---

## 参考情報

- 関連Issue（案Cの修正）: terminalManager.tsでの日本語長文入力バグ修正
- node-pty: https://github.com/microsoft/node-pty
- Electron パッケージング: https://www.electronjs.org/docs/latest/tutorial/application-distribution
