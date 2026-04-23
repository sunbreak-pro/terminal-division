import * as terminalManager from "../services/terminalManager";

// スペースまたはダブルクォートを含む場合のみクオート。埋め込みクオートは \" にエスケープ。
function formatPath(path: string): string {
  if (!path.includes(" ") && !path.includes('"')) return path;
  return `"${path.replace(/"/g, '\\"')}"`;
}

// 複数パスはスペース区切りで連結
export function formatPaths(paths: string[]): string {
  return paths.map(formatPath).join(" ");
}

// ファイル選択ダイアログを開き、選択されたパスを指定ターミナルのカーソル位置に挿入する。
// 選択がキャンセルされた場合は何もしない。挿入後はターミナルにフォーカスを戻す。
export async function promptAndInsertFiles(terminalId: string): Promise<void> {
  try {
    const paths = await window.api.dialog.selectFiles();
    if (!paths || paths.length === 0) {
      terminalManager.focus(terminalId);
      return;
    }
    window.api.pty.write(terminalId, formatPaths(paths));
    terminalManager.focus(terminalId);
  } catch (error) {
    console.error("Failed to select files:", error);
  }
}
