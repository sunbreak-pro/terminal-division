import {
  useFileOpsHistoryStore,
  type FileOp,
} from "../stores/fileOpsHistoryStore";
import { showErrorToast } from "../components/Sidebar/ErrorToast";
import { basenameOf } from "../utils/labelCollision";

/**
 * ユーザー操作のラッパー: 実行 + Undo スタックへの記録を一箇所に集約。
 * 直接 window.api.fs.* を叩く代わりにこれらを使う。
 */

export async function performRename(
  oldPath: string,
  newName: string,
): Promise<string | null> {
  if (newName.length === 0 || newName === basenameOf(oldPath)) return null;
  const result = await window.api.fs.rename(oldPath, newName);
  if (!result.ok) {
    showErrorToast(`名称変更に失敗: ${result.error}`);
    return null;
  }
  useFileOpsHistoryStore
    .getState()
    .pushOp({ kind: "rename", from: oldPath, to: result.newPath });
  return result.newPath;
}

export async function performTrash(targetPath: string): Promise<boolean> {
  const result = await window.api.fs.trashWithTracking(targetPath);
  if (!result.ok) {
    showErrorToast(`削除に失敗: ${result.error}`);
    return false;
  }
  useFileOpsHistoryStore.getState().pushOp({
    kind: "trash",
    originalPath: targetPath,
    trashedAt: result.trashedAt,
  });
  if (!result.trashedAt) {
    showErrorToast(
      "ゴミ箱に入れましたが、戻し操作で復元できる場所を追跡できませんでした(外部ボリュームの可能性)",
    );
  }
  return true;
}

export async function performMove(
  srcPath: string,
  destDir: string,
): Promise<string | null> {
  const result = await window.api.fs.movePath(srcPath, destDir);
  if (!result.ok) {
    showErrorToast(`移動に失敗: ${result.error}`);
    return null;
  }
  useFileOpsHistoryStore
    .getState()
    .pushOp({ kind: "move", from: srcPath, to: result.newPath });
  return result.newPath;
}

export async function performCopy(
  srcPath: string,
  destDir: string,
): Promise<string | null> {
  // copy は undo 対象外(コピー後のパスは履歴に残るが、undo はリリースしない)
  const result = await window.api.fs.copyPath(srcPath, destDir);
  if (!result.ok) {
    showErrorToast(`コピーに失敗: ${result.error}`);
    return null;
  }
  return result.newPath;
}

/**
 * Undo: 直近の操作の逆操作を実行し、redo スタックに積む
 */
export async function undoLast(): Promise<void> {
  const store = useFileOpsHistoryStore.getState();
  const op = store.popUndo();
  if (!op) return;

  switch (op.kind) {
    case "rename": {
      // newName は元のパスの basename (op.from)
      const originalName = basenameOf(op.from);
      const result = await window.api.fs.rename(op.to, originalName);
      if (!result.ok) {
        showErrorToast(`名称変更の取り消しに失敗: ${result.error}`);
        // 失敗時は元のスタックに戻す
        store.pushUndo(op);
        return;
      }
      store.pushRedo(op);
      break;
    }
    case "move": {
      // op.to の親へ戻す代わりに op.from の親へ戻す
      const originalParent = parentDir(op.from);
      const result = await window.api.fs.movePath(op.to, originalParent);
      if (!result.ok) {
        showErrorToast(`移動の取り消しに失敗: ${result.error}`);
        store.pushUndo(op);
        return;
      }
      store.pushRedo(op);
      break;
    }
    case "trash": {
      if (!op.trashedAt) {
        showErrorToast(
          "この削除は取り消せません(ゴミ箱内の位置を追跡できませんでした)",
        );
        // 戻せないが、これ以上 undo を進めるのは混乱するので破棄
        return;
      }
      const result = await window.api.fs.restoreFromTrash(
        op.trashedAt,
        op.originalPath,
      );
      if (!result.ok) {
        showErrorToast(`削除の取り消しに失敗: ${result.error}`);
        store.pushUndo(op);
        return;
      }
      store.pushRedo(op);
      break;
    }
  }
}

/**
 * Redo: 直近の取り消し操作を再実行し、undo スタックに戻す
 */
export async function redoLast(): Promise<void> {
  const store = useFileOpsHistoryStore.getState();
  const op = store.popRedo();
  if (!op) return;

  switch (op.kind) {
    case "rename": {
      const newName = basenameOf(op.to);
      const result = await window.api.fs.rename(op.from, newName);
      if (!result.ok) {
        showErrorToast(`名称変更の再実行に失敗: ${result.error}`);
        store.pushRedo(op);
        return;
      }
      store.pushUndo(op);
      break;
    }
    case "move": {
      const destDir = parentDir(op.to);
      const result = await window.api.fs.movePath(op.from, destDir);
      if (!result.ok) {
        showErrorToast(`移動の再実行に失敗: ${result.error}`);
        store.pushRedo(op);
        return;
      }
      store.pushUndo(op);
      break;
    }
    case "trash": {
      const result = await window.api.fs.trashWithTracking(op.originalPath);
      if (!result.ok) {
        showErrorToast(`削除の再実行に失敗: ${result.error}`);
        store.pushRedo(op);
        return;
      }
      // 新しい trashedAt を更新して push
      store.pushUndo({
        kind: "trash",
        originalPath: op.originalPath,
        trashedAt: result.trashedAt,
      });
      break;
    }
  }
}

function parentDir(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  if (idx <= 0) return "/";
  return p.slice(0, idx);
}

export type { FileOp };
