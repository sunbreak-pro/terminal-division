# UI 改善計画

このドキュメントでは、Terminal Division の UI に関する改善案や追加機能のアイデアを管理します。

---

## バグ修正: ネストしたPanelGroupリサイズバグ

### バグ概要
親PanelGroupの最初の子がネストしたPanelGroupの場合、親のリサイズハンドルが逆方向に動作する。
- マウスを下に動かすと境目が上に動く（水平分割の場合）
- マウスを右に動かすと境目が左に動く（縦分割の場合）

### 決定事項
- react-resizable-panels v4へのアップグレードで対応（破壊的変更を許容）
- ライブラリ移行不可（react-resizable-panels内で解決）

---

### 実装手順

#### Step 1: パッケージアップグレード
```bash
npm install react-resizable-panels@latest
```

#### Step 2: SplitContainer.tsx の修正

**ファイル**: `src/renderer/src/components/SplitContainer.tsx`

##### 2-1. インポート文の変更（3行目付近）
```tsx
// Before
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

// After
import { Group, Panel, Separator } from 'react-resizable-panels'
```

##### 2-2. PanelGroup → Group に変更（renderNode関数内）
```tsx
// Before
<PanelGroup
  key={nodeId}
  id={nodeId}
  direction={splitNode.direction}
  style={{ height: '100%', width: '100%' }}
>

// After
<Group
  key={nodeId}
  id={nodeId}
  orientation={splitNode.direction}
  style={{ height: '100%', width: '100%' }}
>
```

##### 2-3. overflow: hidden ラッパーdivの削除
```tsx
// Before
<Panel id={childId} minSize={10} defaultSize={100 / splitNode.children.length}>
  {isNestedSplit ? (
    <div style={{ height: '100%', width: '100%', overflow: 'hidden' }}>
      {renderNode(childId)}
    </div>
  ) : (
    renderNode(childId)
  )}
</Panel>

// After（シンプルに統一）
<Panel id={childId} minSize={10} defaultSize={100 / splitNode.children.length}>
  {renderNode(childId)}
</Panel>
```

##### 2-4. PanelResizeHandle → Separator に変更
```tsx
// Before
<PanelResizeHandle
  id={`handle-${nodeId}-${index}`}
  style={{ touchAction: 'none', userSelect: 'none' }}
/>

// After
<Separator
  id={`handle-${nodeId}-${index}`}
  style={{ touchAction: 'none', userSelect: 'none' }}
/>
```

##### 2-5. 閉じタグの変更
```tsx
// Before
</PanelGroup>

// After
</Group>
```

#### Step 3: globals.css の修正

**ファイル**: `src/renderer/src/styles/globals.css`

##### 3-1. 水平方向リサイズハンドル（66-75行目付近）
```css
/* Before */
[data-panel-group-direction="horizontal"] > [data-panel-resize-handle-id] {
  width: 4px;
  background-color: #3c3c3c;
  transition: background-color 0.15s ease;
}

[data-panel-group-direction="horizontal"] > [data-panel-resize-handle-id]:hover,
[data-panel-group-direction="horizontal"] > [data-panel-resize-handle-id][data-resize-handle-active] {
  background-color: #007acc;
}

/* After */
[aria-orientation="horizontal"] > [data-panel-resize-handle-id] {
  width: 4px;
  background-color: #3c3c3c;
  transition: background-color 0.15s ease;
}

[aria-orientation="horizontal"] > [data-panel-resize-handle-id]:hover,
[aria-orientation="horizontal"] > [data-panel-resize-handle-id][data-resize-handle-active] {
  background-color: #007acc;
}
```

##### 3-2. 垂直方向リサイズハンドル（77-86行目付近）
```css
/* Before */
[data-panel-group-direction="vertical"] > [data-panel-resize-handle-id] {
  height: 4px;
  background-color: #3c3c3c;
  transition: background-color 0.15s ease;
}

[data-panel-group-direction="vertical"] > [data-panel-resize-handle-id]:hover,
[data-panel-group-direction="vertical"] > [data-panel-resize-handle-id][data-resize-handle-active] {
  background-color: #007acc;
}

/* After */
[aria-orientation="vertical"] > [data-panel-resize-handle-id] {
  height: 4px;
  background-color: #3c3c3c;
  transition: background-color 0.15s ease;
}

[aria-orientation="vertical"] > [data-panel-resize-handle-id]:hover,
[aria-orientation="vertical"] > [data-panel-resize-handle-id][data-resize-handle-active] {
  background-color: #007acc;
}
```

##### 3-3. position: relative の削除を検討（89-91行目付近）
```css
/* 削除または条件付きに変更 */
[data-panel-group] {
  position: relative;  /* ← 問題が続く場合は削除 */
}
```

---

### 代替案（v4で解決しない場合）

#### 代替案A: Panelにoverflow: hiddenを直接適用
```tsx
<Panel
  id={childId}
  minSize={10}
  defaultSize={100 / splitNode.children.length}
  style={{ overflow: 'hidden' }}
>
  {renderNode(childId)}
</Panel>
```

#### 代替案B: position: relative の削除
globals.cssから`[data-panel-group] { position: relative; }`を削除。

---

### 修正対象ファイル一覧

| ファイル | 変更箇所 |
|---------|---------|
| `package.json` | react-resizable-panelsをv4に更新 |
| `src/renderer/src/components/SplitContainer.tsx` | インポート、コンポーネント名、props、ラッパー削除 |
| `src/renderer/src/styles/globals.css` | CSSセレクタを`aria-orientation`に変更 |

---

### 検証方法

#### 1. 基本動作確認
```
npm run dev
```
- シングルターミナルからの縦分割（Cmd+D）が動作すること
- シングルターミナルからの水平分割（Cmd+Shift+D）が動作すること

#### 2. バグ再現テスト
**テストケース1**: 水平分割 → 上部縦分割
1. アプリ起動
2. `Cmd+Shift+D` で水平分割
3. 上部で `Cmd+D` で縦分割
4. 親のリサイズハンドル（上部全体と下部の境目）を上下にドラッグ
5. **期待結果**: マウスと同じ方向に境目が動く

**テストケース2**: 縦分割 → 左側水平分割
1. アプリ起動
2. `Cmd+D` で縦分割
3. 左側で `Cmd+Shift+D` で水平分割
4. 親のリサイズハンドル（左側全体と右側の境目）を左右にドラッグ
5. **期待結果**: マウスと同じ方向に境目が動く

#### 3. 回帰テスト
- 4分割まで正常に分割できること
- 各ターミナルが閉じられること（Cmd+W）
- リサイズ後のレイアウトが維持されること
- アクティブターミナルの切り替えが正常に動作すること

---

## 検討中の機能

（ここに追加予定の機能を記載）

## 完了した機能

（実装済みの機能を記録）
