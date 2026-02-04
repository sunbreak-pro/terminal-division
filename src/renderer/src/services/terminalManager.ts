import { Terminal, ITerminalOptions } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

export interface TerminalInstance {
  terminal: Terminal
  fitAddon: FitAddon
  ptyCreated: boolean
  compositionRegistered: boolean
  dataListenerRemover: (() => void) | null
  exitListenerRemover: (() => void) | null
}

// Module-scope registry (independent of React lifecycle)
const registry = new Map<string, TerminalInstance>()

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

  // IME composition state tracking
  // When composing (e.g., typing Japanese), macOS IME may split long compositions
  // and xterm.js may fire onData with partial text. We skip those to prevent corruption.
  let isComposing = false
  // Track data sent via compositionend to prevent double-sending
  // (xterm.js sends the same data via setTimeout(0) after compositionend)
  let lastCompositionData: string | null = null

  // Register terminal.onData listener ONCE during instance creation
  const terminalDataDisposable = terminal.onData((data) => {
    // Skip data during composition to prevent partial text being sent
    if (isComposing) {
      return
    }
    // Skip if this data was already sent via compositionend (prevent double-send)
    if (lastCompositionData !== null && data === lastCompositionData) {
      lastCompositionData = null
      return
    }
    lastCompositionData = null
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
        isComposing = true
        lastCompositionData = null
      })
      textarea.addEventListener('compositionend', (e: CompositionEvent) => {
        isComposing = false
        // Send the confirmed text directly from compositionend event
        // This avoids relying on xterm.js's setTimeout(0) which can race with
        // the next compositionstart when macOS IME splits long compositions
        if (e.data && e.data.length > 0) {
          lastCompositionData = e.data
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
    exitListenerRemover
  }

  // Store the registration function for use in attachToContainer
  ;(instance as TerminalInstance & { _registerComposition?: () => void })._registerComposition =
    registerCompositionListeners

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

/**
 * Fit terminal to its container
 */
export function fit(id: string): { cols: number; rows: number } | null {
  const instance = registry.get(id)
  if (!instance) return null

  try {
    instance.fitAddon.fit()
    return {
      cols: instance.terminal.cols,
      rows: instance.terminal.rows
    }
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
