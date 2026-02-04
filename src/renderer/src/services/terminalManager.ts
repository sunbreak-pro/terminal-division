import { Terminal, ITerminalOptions } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

export interface TerminalInstance {
  terminal: Terminal
  fitAddon: FitAddon
  ptyCreated: boolean
  isComposing: boolean
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

  // IME composition state flag
  let isComposing = false

  // Register terminal.onData listener ONCE during instance creation
  // Skip sending data to PTY during IME composition to prevent character duplication
  const terminalDataDisposable = terminal.onData((data) => {
    if (isComposing) return
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

  const instance: TerminalInstance = {
    terminal,
    fitAddon,
    ptyCreated: false,
    isComposing: false,
    compositionRegistered: false,
    dataListenerRemover: () => {
      terminalDataDisposable.dispose()
      dataListenerRemover()
    },
    exitListenerRemover
  }

  // Create a closure to update isComposing from composition events
  // Store the setter on the instance for use in attachToContainer
  ;(instance as TerminalInstance & { setComposing: (v: boolean) => void }).setComposing = (
    v: boolean
  ) => {
    isComposing = v
    instance.isComposing = v
  }

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

  // Register IME composition events (only once)
  const textarea = instance.terminal.element?.querySelector('textarea')
  const setComposing = (instance as TerminalInstance & { setComposing?: (v: boolean) => void })
    .setComposing
  if (textarea && !instance.compositionRegistered && setComposing) {
    textarea.addEventListener('compositionstart', () => {
      setComposing(true)
    })
    textarea.addEventListener('compositionend', () => {
      setComposing(false)
    })
    instance.compositionRegistered = true
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
