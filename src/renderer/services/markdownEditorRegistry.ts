// 各ペインの MarkdownEditor インスタンスへの imperative API を保持する。
// CodeMirror の現在 doc を参照したい / save をトリガしたい外部呼び出し
// (タブ切替モーダル、Cmd+W ガード等) のための薄い registry。
//
// React ライフサイクルの外側に置くため、xterm.js の terminalManager と
// 同じ「モジュール scope の Map」パターンを採用する。

export interface MarkdownEditorApi {
  // CodeMirror の現在 doc を返す。register 解除後は呼ばないこと。
  getContent: () => string;
  // ファイル保存をトリガし、成功なら true を返す。
  // エディタ側で fs:writeFile + markMdSaved を呼ぶ。
  save: () => Promise<boolean>;
  // CodeMirror に focus を戻す。
  focus: () => void;
}

const registry = new Map<string, MarkdownEditorApi>();

export function register(id: string, api: MarkdownEditorApi): void {
  registry.set(id, api);
}

export function unregister(id: string): void {
  registry.delete(id);
}

export function getApi(id: string): MarkdownEditorApi | null {
  return registry.get(id) ?? null;
}
