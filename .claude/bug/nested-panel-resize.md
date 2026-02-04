# ネストしたPanelGroupリサイズバグ

## 概要
react-resizable-panels を使用したネストしたPanelGroup構造において、親PanelGroupのリサイズハンドルが逆方向に動作するバグ。

---

## バグの詳細

### 共通パターン
**親PanelGroupの最初の子がネストしたPanelGroupの場合**、親のリサイズハンドルが逆方向に動く。
- マウスを下に動かすと境目が上に動く
- マウスを右に動かすと境目が左に動く

### バグ1: 水平分割後の上部縦分割

**再現手順**:
1. アプリ起動（シングルターミナル）
2. 水平分割（`Cmd+Shift+D`）→ 上下に分かれる
3. 上部のターミナルで縦分割（`Cmd+D`）→ 上部が左右に分かれる
4. 水平境目（上部全体と下部を分ける線）を上下にドラッグ

**症状**: マウスを下に動かすと境目が上に動く（逆方向）

**レイアウト構造**:
```
PanelGroup (vertical)
├── Panel (上部)
│   └── PanelGroup (horizontal) ← ネストしたPanelGroup
│       ├── Panel (左)
│       └── Panel (右)
├── ResizeHandle ← このハンドルが逆方向に動く
└── Panel (下部)
```

### バグ2: 縦分割後の左側水平分割

**再現手順**:
1. アプリ起動（シングルターミナル）
2. 縦分割（`Cmd+D`）→ 左右に分かれる
3. 左側のターミナルで水平分割（`Cmd+Shift+D`）→ 左側が上下に分かれる
4. 垂直境目（左側全体と右側を分ける線）を左右にドラッグ

**症状**: マウスを右に動かすと境目が左に動く（逆方向）

**レイアウト構造**:
```
PanelGroup (horizontal)
├── Panel (左側)
│   └── PanelGroup (vertical) ← ネストしたPanelGroup
│       ├── Panel (上)
│       └── Panel (下)
├── ResizeHandle ← このハンドルが逆方向に動く
└── Panel (右側)
```

---

## 試した修正（効果なし）

### 1. CSS削除
**ファイル**: `src/renderer/src/styles/globals.css` 99-108行目

**変更内容**: `min-width: 0` / `min-height: 0` のルールを削除

**結果**: 効果なし

### 2. ラッパーdiv追加
**ファイル**: `src/renderer/src/components/SplitContainer.tsx`

**変更内容**: ネストしたPanelGroupを`overflow: hidden`のdivでラップ

**結果**: 効果なし

---

## 関連ファイル

| ファイル | 役割 |
|---------|------|
| `src/renderer/src/components/SplitContainer.tsx` | PanelGroup/Panelの再帰的レンダリング |
| `src/renderer/src/styles/globals.css` | パネル関連のスタイル |
| `src/renderer/src/stores/terminalStore.ts` | レイアウト状態管理（split関連） |

---

## 今後の調査方針

### 1. react-resizable-panels のIssue確認
- GitHubリポジトリで類似のバグ報告がないか確認
- ネストしたPanelGroupに関する既知の問題を調査

### 2. コンポーネント構造の見直し
- 最初の子だけで発生する点から、Panelのレンダリング順序に問題がある可能性
- 再帰的レンダリングの方法を変更する

### 3. イベントハンドリングの調査
- ResizeHandleのマウスイベントがどのように処理されているか確認
- ネストした構造でイベントが干渉していないか調査

### 4. 代替ライブラリの検討
- 問題が解決しない場合、他のリサイズライブラリを検討
  - react-split-pane
  - allotment
  - カスタム実装

---

## 参考情報

- react-resizable-panels: https://github.com/bvaughn/react-resizable-panels
- 使用バージョン: （package.jsonで確認が必要）
