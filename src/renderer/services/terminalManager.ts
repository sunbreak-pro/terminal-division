import { Terminal, ITerminalOptions } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'

// 入力履歴の状態管理
interface InputHistoryState {
  undoStack: string[] // 過去の入力履歴
  redoStack: string[] // undoした入力
  currentLine: string // 現在の行内容
}

// undoスタックの最大サイズ
const MAX_UNDO_STACK_SIZE = 100

export interface TerminalInstance {
  terminal: Terminal
  fitAddon: FitAddon
  ptyCreated: boolean
  compositionRegistered: boolean
  dataListenerRemover: (() => void) | null
  exitListenerRemover: (() => void) | null
  inputHistory: InputHistoryState
}

// Module-scope registry (independent of React lifecycle)
const registry = new Map<string, TerminalInstance>()

// Undo/Redo操作中フラグ（各ターミナルID毎）
// これがtrueの間は、PTYからのエコーバックによる履歴の再記録をスキップする
const undoRedoInProgress = new Map<string, boolean>()

// Undo/Redoタイマー管理（連続操作時に古いタイマーをキャンセルするため）
const undoRedoTimers = new Map<string, ReturnType<typeof setTimeout>>()

// 送信済みテキスト追跡（PTYエコーバックによる重複記録を防ぐ）
// Undo/Redoで送信したテキストを記録し、recordHistoryで同じテキストが来たらスキップ
const pendingSentText = new Map<string, string>()

export interface TerminalCallbacks {
  onData: (data: string) => void
  onExit: () => void
}

/**
 * Get an existing terminal instance or create a new one
 * Callbacks are only registered once when the instance is first created
 */
export function getOrCreate(
  id: string,
  options: ITerminalOptions,
  callbacks: TerminalCallbacks
): TerminalInstance {
  const existing = registry.get(id)
  if (existing) {
    return existing
  }

  const terminal = new Terminal(options)
  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)

  // WebLinksAddon: Cmd+クリック（Mac）/ Ctrl+クリック（Win/Linux）で外部ブラウザを開く
  const webLinksAddon = new WebLinksAddon((event, url) => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
    const modifierPressed = isMac ? event.metaKey : event.ctrlKey

    if (modifierPressed) {
      event.preventDefault()
      window.api.shell.openExternal(url)
    }
  })
  terminal.loadAddon(webLinksAddon)

  // IME composition state tracking
  // When composing (e.g., typing Japanese), macOS IME may split long compositions
  // and xterm.js may fire onData with partial text. We skip those to prevent corruption.
  let isComposing = false
  // Track data sent via compositionend to prevent double-sending
  // (xterm.js sends the same data via setTimeout(0) after compositionend)
  let lastCompositionData: string | null = null

  // 入力履歴の参照（instanceが作成された後に設定）
  let inputHistoryRef: InputHistoryState | null = null

  // ヘルパー関数: 制御文字かどうか判定
  const isControlChar = (char: string): boolean => {
    return char.length === 1 && char.charCodeAt(0) < 32
  }

  // ヘルパー関数: 履歴を記録
  const recordHistory = (newLine: string): void => {
    if (!inputHistoryRef) return

    // Undo/Redo操作中は履歴を記録しない（エコーバックによる汚染を防ぐ）
    if (undoRedoInProgress.get(id)) {
      console.log('[recordHistory] SKIPPED (undo/redo in progress)')
      return
    }

    // 送信済みテキストと一致する場合はスキップ（Undo/Redoのエコーバック）
    const pending = pendingSentText.get(id)
    if (pending !== undefined && pending === newLine) {
      console.log('[recordHistory] SKIPPED (matches pending sent text):', JSON.stringify(pending))
      pendingSentText.delete(id)
      return
    }

    console.log('[recordHistory] newLine:', JSON.stringify(newLine))
    console.log(
      '[recordHistory] currentLine before:',
      JSON.stringify(inputHistoryRef.currentLine)
    )
    console.log('[recordHistory] undoStack before:', JSON.stringify(inputHistoryRef.undoStack))
    // 新しい入力があったらredoスタックをクリア
    inputHistoryRef.redoStack = []
    // 現在の状態をundoスタックに保存
    inputHistoryRef.undoStack.push(inputHistoryRef.currentLine)
    // スタックサイズを制限
    if (inputHistoryRef.undoStack.length > MAX_UNDO_STACK_SIZE) {
      inputHistoryRef.undoStack.shift()
    }
    // 行内容を更新
    inputHistoryRef.currentLine = newLine
    console.log('[recordHistory] undoStack after:', JSON.stringify(inputHistoryRef.undoStack))
    console.log('[recordHistory] currentLine after:', JSON.stringify(inputHistoryRef.currentLine))
  }

  // Register terminal.onData listener ONCE during instance creation
  const terminalDataDisposable = terminal.onData((data) => {
    console.log(
      '[onData] isComposing:',
      isComposing,
      'lastCompositionData:',
      lastCompositionData ? JSON.stringify(lastCompositionData) : null,
      'data:',
      JSON.stringify(data)
    )

    // Non-ASCII characters during IME composition are handled by compositionend only.
    // Skip them here to prevent double-send or corruption during long IME compositions.
    // But allow non-ASCII when NOT composing (e.g., paste operations).
    if (isComposing && /[^\x00-\x7F]/.test(data)) {
      console.log('[onData] SKIPPED (non-ASCII during composition)')
      return
    }

    // Skip if this data was already sent via compositionend (prevent double-send)
    if (lastCompositionData !== null && data === lastCompositionData) {
      lastCompositionData = null
      console.log('[onData] SKIPPED (duplicate of compositionend)')
      return
    }
    lastCompositionData = null

    // 履歴管理
    if (inputHistoryRef) {
      // Enterキー（\r）で行確定 → 履歴をリセット
      if (data === '\r' || data === '\n') {
        inputHistoryRef.undoStack = []
        inputHistoryRef.redoStack = []
        inputHistoryRef.currentLine = ''
      }
      // Backspace処理
      else if (data === '\x7f' || data === '\b') {
        recordHistory(inputHistoryRef.currentLine.slice(0, -1))
      }
      // Ctrl+W (単語削除): 最後の単語を削除
      else if (data === '\x17') {
        const trimmed = inputHistoryRef.currentLine.replace(/\s*\S+\s*$/, '')
        recordHistory(trimmed)
      }
      // Ctrl+U (行頭まで削除): 行をクリア
      else if (data === '\x15') {
        recordHistory('')
      }
      // 通常入力: 履歴を記録
      else if (data.length > 0 && !isControlChar(data)) {
        recordHistory(inputHistoryRef.currentLine + data)
      }
    }

    console.log('[onData] SENT')
    callbacks.onData(data)
  })

  // Register IPC listeners ONCE during instance creation
  const dataListenerRemover = window.api.pty.onData((event) => {
    if (event.id === id) {
      terminal.write(event.data)
    }
  })

  const exitListenerRemover = window.api.pty.onExit((event) => {
    if (event.id === id) {
      callbacks.onExit()
    }
  })

  // Function to register composition event listeners on the textarea
  const registerCompositionListeners = (): void => {
    const textarea = terminal.element?.querySelector('textarea')
    if (textarea) {
      textarea.addEventListener('compositionstart', () => {
        console.log('[compositionstart]')
        isComposing = true
        lastCompositionData = null
      })
      textarea.addEventListener('compositionupdate', (e: CompositionEvent) => {
        console.log('[compositionupdate] data:', JSON.stringify(e.data))
      })
      textarea.addEventListener('compositionend', (e: CompositionEvent) => {
        console.log('[compositionend] data:', JSON.stringify(e.data))
        isComposing = false
        // Send the confirmed text directly from compositionend event
        // This avoids relying on xterm.js's setTimeout(0) which can race with
        // the next compositionstart when macOS IME splits long compositions
        if (e.data && e.data.length > 0) {
          lastCompositionData = e.data
          console.log('[compositionend] SENDING:', JSON.stringify(e.data))

          // 日本語入力も履歴に記録する
          if (inputHistoryRef) {
            recordHistory(inputHistoryRef.currentLine + e.data)
          }

          callbacks.onData(e.data)
        }
      })
    }
  }

  const instance: TerminalInstance = {
    terminal,
    fitAddon,
    ptyCreated: false,
    compositionRegistered: false,
    dataListenerRemover: () => {
      terminalDataDisposable.dispose()
      dataListenerRemover()
    },
    exitListenerRemover,
    inputHistory: {
      undoStack: [],
      redoStack: [],
      currentLine: ''
    }
  }

  // Store the registration function for use in attachToContainer
  ;(instance as TerminalInstance & { _registerComposition?: () => void })._registerComposition =
    registerCompositionListeners

  // inputHistoryRefを設定
  inputHistoryRef = instance.inputHistory

  registry.set(id, instance)
  return instance
}

/**
 * Get an existing terminal instance
 */
export function get(id: string): TerminalInstance | undefined {
  return registry.get(id)
}

/**
 * Check if a terminal instance exists
 */
export function has(id: string): boolean {
  return registry.has(id)
}

/**
 * Destroy a terminal instance (only call when closing the terminal)
 */
export function destroy(id: string): void {
  const instance = registry.get(id)
  if (!instance) return

  // Remove listeners
  if (instance.dataListenerRemover) {
    instance.dataListenerRemover()
  }
  if (instance.exitListenerRemover) {
    instance.exitListenerRemover()
  }

  // Dispose terminal
  instance.terminal.dispose()

  registry.delete(id)
  // サイズキャッシュのクリーンアップ
  lastSizes.delete(id)
  // Undo/Redo関連のクリーンアップ
  undoRedoInProgress.delete(id)
  // タイマーをキャンセルしてクリア
  const existingTimer = undoRedoTimers.get(id)
  if (existingTimer) {
    clearTimeout(existingTimer)
    undoRedoTimers.delete(id)
  }
  // 送信済みテキスト追跡をクリア
  pendingSentText.delete(id)
}

/**
 * Attach terminal to a DOM container
 */
export function attachToContainer(id: string, container: HTMLElement): void {
  const instance = registry.get(id)
  if (!instance) return

  // Check if already attached to this container
  const terminalElement = instance.terminal.element
  if (terminalElement && terminalElement.parentElement === container) {
    return
  }

  // If terminal was previously opened elsewhere, we need to reattach
  if (terminalElement && terminalElement.parentElement) {
    // Move the existing terminal element to the new container
    container.appendChild(terminalElement)
  } else {
    // First time opening
    instance.terminal.open(container)
  }

  // Register composition event listeners after terminal is attached to DOM
  if (!instance.compositionRegistered) {
    const registerFn = (instance as TerminalInstance & { _registerComposition?: () => void })
      ._registerComposition
    if (registerFn) {
      registerFn()
      instance.compositionRegistered = true
    }
  }
}

/**
 * Detach terminal from its current container (does NOT dispose)
 */
export function detachFromContainer(id: string): void {
  const instance = registry.get(id)
  if (!instance) return

  // We don't remove from DOM here - just disconnect observers etc.
  // The terminal element stays where it is until reattached or destroyed
}

/**
 * Resize terminal
 */
export function resize(id: string, cols: number, rows: number): void {
  const instance = registry.get(id)
  if (!instance) return

  instance.terminal.resize(cols, rows)
}

// 前回のサイズを保存（不要なIPCを避けるため）
const lastSizes = new Map<string, { cols: number; rows: number }>()

/**
 * Fit terminal to its container
 * @returns サイズが変更された場合は新しいサイズ、変更がない場合はnull
 */
export function fit(id: string): { cols: number; rows: number } | null {
  const instance = registry.get(id)
  if (!instance) return null

  try {
    instance.fitAddon.fit()
    const newSize = {
      cols: instance.terminal.cols,
      rows: instance.terminal.rows
    }

    // サイズが変わっていない場合はnullを返す（IPCを節約）
    const lastSize = lastSizes.get(id)
    if (lastSize && lastSize.cols === newSize.cols && lastSize.rows === newSize.rows) {
      return null
    }

    lastSizes.set(id, newSize)
    return newSize
  } catch {
    return null
  }
}

/**
 * Focus terminal
 */
export function focus(id: string): void {
  const instance = registry.get(id)
  if (!instance) return

  instance.terminal.focus()
}

/**
 * ターミナルのテーマを更新
 */
export function updateTheme(id: string, xtermTheme: Record<string, string>): void {
  const instance = registry.get(id)
  if (!instance) return

  instance.terminal.options.theme = xtermTheme
}

/**
 * 全ターミナルのテーマを一括更新
 */
export function updateAllThemes(xtermTheme: Record<string, string>): void {
  for (const [id] of registry) {
    updateTheme(id, xtermTheme)
  }
}

/**
 * カーソルがある行全体を選択
 */
export function selectCurrentLine(id: string): void {
  const instance = registry.get(id)
  if (!instance) return

  const terminal = instance.terminal
  const buffer = terminal.buffer.active
  const cursorY = buffer.cursorY + buffer.viewportY

  terminal.selectLines(cursorY, cursorY)
}

/**
 * 選択テキストを取得
 */
export function getSelection(id: string): string {
  const instance = registry.get(id)
  if (!instance) return ''
  return instance.terminal.getSelection()
}

/**
 * 選択をクリア
 */
export function clearSelection(id: string): void {
  const instance = registry.get(id)
  if (!instance) return
  instance.terminal.clearSelection()
}

/**
 * Undo操作を実行
 * @returns 行をクリアして再入力するためのコマンド文字列、またはnull
 */
export function undo(id: string): { clearCmd: string; newText: string } | null {
  const instance = registry.get(id)
  if (!instance) return null

  const { inputHistory } = instance
  console.log('[undo] undoStack:', JSON.stringify(inputHistory.undoStack))
  console.log('[undo] redoStack:', JSON.stringify(inputHistory.redoStack))
  console.log('[undo] currentLine:', JSON.stringify(inputHistory.currentLine))

  if (inputHistory.undoStack.length === 0) {
    console.log('[undo] undoStack is empty, returning null')
    return null
  }

  // Undo/Redo操作中フラグを設定（エコーバックによる履歴汚染を防ぐ）
  undoRedoInProgress.set(id, true)
  console.log('[undo] set undoRedoInProgress = true')

  // 現在の状態をredoスタックに保存
  inputHistory.redoStack.push(inputHistory.currentLine)

  // undoスタックから前の状態を復元
  const previousState = inputHistory.undoStack.pop()!
  inputHistory.currentLine = previousState

  // 送信するテキストを追跡（エコーバックによる重複記録を防ぐ）
  pendingSentText.set(id, previousState)
  console.log('[undo] set pendingSentText:', JSON.stringify(previousState))

  console.log('[undo] returning newText:', JSON.stringify(previousState))
  console.log('[undo] undoStack after:', JSON.stringify(inputHistory.undoStack))
  console.log('[undo] redoStack after:', JSON.stringify(inputHistory.redoStack))

  // 既存のタイマーをキャンセル（連続Undo操作時に古いタイマーが先にフラグをリセットするのを防ぐ）
  const existingTimer = undoRedoTimers.get(id)
  if (existingTimer) {
    clearTimeout(existingTimer)
    console.log('[undo] cancelled existing timer')
  }

  // 一定時間後にフラグをリセット（PTYからのエコーバックが処理された後）
  // パッケージ版ではPTYエコーバックが遅い可能性があるため、300msに延長
  const timer = setTimeout(() => {
    undoRedoInProgress.set(id, false)
    undoRedoTimers.delete(id)
    console.log('[undo] set undoRedoInProgress = false (after 300ms)')
  }, 300)
  undoRedoTimers.set(id, timer)

  return {
    clearCmd: '\x15', // Ctrl+U: 行全体をクリア
    newText: previousState
  }
}

/**
 * Redo操作を実行
 */
export function redo(id: string): { clearCmd: string; newText: string } | null {
  const instance = registry.get(id)
  if (!instance) return null

  const { inputHistory } = instance
  console.log('[redo] undoStack:', JSON.stringify(inputHistory.undoStack))
  console.log('[redo] redoStack:', JSON.stringify(inputHistory.redoStack))
  console.log('[redo] currentLine:', JSON.stringify(inputHistory.currentLine))

  if (inputHistory.redoStack.length === 0) {
    console.log('[redo] redoStack is empty, returning null')
    return null
  }

  // Undo/Redo操作中フラグを設定（エコーバックによる履歴汚染を防ぐ）
  undoRedoInProgress.set(id, true)
  console.log('[redo] set undoRedoInProgress = true')

  // 現在の状態をundoスタックに保存
  inputHistory.undoStack.push(inputHistory.currentLine)

  // redoスタックから復元
  const nextState = inputHistory.redoStack.pop()!
  inputHistory.currentLine = nextState

  // 送信するテキストを追跡（エコーバックによる重複記録を防ぐ）
  pendingSentText.set(id, nextState)
  console.log('[redo] set pendingSentText:', JSON.stringify(nextState))

  console.log('[redo] returning newText:', JSON.stringify(nextState))
  console.log('[redo] undoStack after:', JSON.stringify(inputHistory.undoStack))
  console.log('[redo] redoStack after:', JSON.stringify(inputHistory.redoStack))

  // 既存のタイマーをキャンセル（連続Redo操作時に古いタイマーが先にフラグをリセットするのを防ぐ）
  const existingTimer = undoRedoTimers.get(id)
  if (existingTimer) {
    clearTimeout(existingTimer)
    console.log('[redo] cancelled existing timer')
  }

  // 一定時間後にフラグをリセット（PTYからのエコーバックが処理された後）
  // パッケージ版ではPTYエコーバックが遅い可能性があるため、300msに延長
  const timer = setTimeout(() => {
    undoRedoInProgress.set(id, false)
    undoRedoTimers.delete(id)
    console.log('[redo] set undoRedoInProgress = false (after 300ms)')
  }, 300)
  undoRedoTimers.set(id, timer)

  return {
    clearCmd: '\x15',
    newText: nextState
  }
}

/**
 * 行全体をクリア（Cmd+Backspace用）
 * 履歴に記録してからPTYにクリアコマンドを返す
 */
export function clearLine(id: string): { moveToEnd: string; clearCmd: string } | null {
  const instance = registry.get(id)
  if (!instance) return null

  const { inputHistory } = instance
  console.log('[clearLine] currentLine:', JSON.stringify(inputHistory.currentLine))
  console.log('[clearLine] undoStack before:', JSON.stringify(inputHistory.undoStack))

  // 現在の行が空でない場合のみ履歴に記録
  if (inputHistory.currentLine !== '') {
    // redoスタックをクリア（新しい操作が行われたため）
    inputHistory.redoStack = []
    // 現在の状態をundoスタックに保存
    inputHistory.undoStack.push(inputHistory.currentLine)
    // スタックサイズを制限
    if (inputHistory.undoStack.length > MAX_UNDO_STACK_SIZE) {
      inputHistory.undoStack.shift()
    }
    // 行内容を空にする
    inputHistory.currentLine = ''
  }

  console.log('[clearLine] undoStack after:', JSON.stringify(inputHistory.undoStack))
  console.log('[clearLine] currentLine after:', JSON.stringify(inputHistory.currentLine))

  return {
    moveToEnd: '\x05', // Ctrl+E: 行末へ
    clearCmd: '\x15' // Ctrl+U: 行頭まで削除
  }
}

/**
 * 行確定時に履歴をリセット（Enter押下時）
 * 注意: 新しいオブジェクトを作成すると、getOrCreate内のinputHistoryRefの参照が切れるため、
 * 既存オブジェクトのプロパティをリセットする
 */
export function resetInputHistory(id: string): void {
  const instance = registry.get(id)
  if (!instance) return

  console.log('[resetInputHistory] before reset:', JSON.stringify(instance.inputHistory))

  // 新しいオブジェクトを作成せず、既存オブジェクトの値をリセット
  // これにより inputHistoryRef の参照が切れない
  instance.inputHistory.undoStack = []
  instance.inputHistory.redoStack = []
  instance.inputHistory.currentLine = ''

  console.log('[resetInputHistory] after reset:', JSON.stringify(instance.inputHistory))
}
