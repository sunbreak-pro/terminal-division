import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// xterm.jsとFitAddonのモック (vi.mockのファクトリ内でクラス定義)
vi.mock('@xterm/xterm', () => {
  class MockTerminal {
    loadAddon = vi.fn()
    open = vi.fn()
    dispose = vi.fn()
    onData = vi.fn().mockReturnValue({ dispose: vi.fn() })
    focus = vi.fn()
    resize = vi.fn()
    cols = 80
    rows = 24
    element = null
    buffer = {
      active: { cursorY: 0, viewportY: 0 }
    }
    selectLines = vi.fn()
    getSelection = vi.fn().mockReturnValue('')
    clearSelection = vi.fn()
  }
  return { Terminal: MockTerminal }
})

vi.mock('@xterm/addon-fit', () => {
  class MockFitAddon {
    fit = vi.fn()
  }
  return { FitAddon: MockFitAddon }
})

vi.mock('@xterm/addon-web-links', () => {
  class MockWebLinksAddon {
    constructor(_handler: unknown) {}
  }
  return { WebLinksAddon: MockWebLinksAddon }
})

// window.apiモック
const mockPtyApi = {
  create: vi.fn().mockResolvedValue('mock-pty-id'),
  write: vi.fn(),
  resize: vi.fn(),
  destroy: vi.fn(),
  kill: vi.fn(),
  onData: vi.fn().mockReturnValue(() => {}),
  onExit: vi.fn().mockReturnValue(() => {})
}

const mockShellApi = {
  openExternal: vi.fn()
}

Object.defineProperty(window, 'api', {
  value: {
    pty: mockPtyApi,
    shell: mockShellApi
  },
  writable: true
})

// テスト対象をインポート（モックの後にインポート）
import * as terminalManager from '../terminalManager'

describe('terminalManager', () => {
  const defaultOptions = {
    fontSize: 14,
    fontFamily: 'monospace'
  }
  const defaultCallbacks = {
    onData: vi.fn(),
    onExit: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('getOrCreate', () => {
    it('should create a new terminal instance', () => {
      const instance = terminalManager.getOrCreate('test-1', defaultOptions, defaultCallbacks)

      expect(instance).toBeDefined()
      expect(instance.terminal).toBeDefined()
      expect(instance.fitAddon).toBeDefined()
      expect(instance.ptyCreated).toBe(false)
      expect(instance.inputHistory).toEqual({
        undoStack: [],
        redoStack: [],
        currentLine: ''
      })
    })

    it('should return existing instance on subsequent calls', () => {
      const instance1 = terminalManager.getOrCreate('test-2', defaultOptions, defaultCallbacks)
      const instance2 = terminalManager.getOrCreate('test-2', defaultOptions, defaultCallbacks)

      expect(instance1).toBe(instance2)
    })

    it('should create separate instances for different ids', () => {
      const instance1 = terminalManager.getOrCreate('test-3a', defaultOptions, defaultCallbacks)
      const instance2 = terminalManager.getOrCreate('test-3b', defaultOptions, defaultCallbacks)

      expect(instance1).not.toBe(instance2)
    })
  })

  describe('get', () => {
    it('should return undefined for non-existent id', () => {
      const instance = terminalManager.get('non-existent')
      expect(instance).toBeUndefined()
    })

    it('should return instance for existing id', () => {
      const created = terminalManager.getOrCreate('test-get', defaultOptions, defaultCallbacks)
      const retrieved = terminalManager.get('test-get')

      expect(retrieved).toBe(created)
    })
  })

  describe('has', () => {
    it('should return false for non-existent id', () => {
      expect(terminalManager.has('non-existent-2')).toBe(false)
    })

    it('should return true for existing id', () => {
      terminalManager.getOrCreate('test-has', defaultOptions, defaultCallbacks)
      expect(terminalManager.has('test-has')).toBe(true)
    })
  })

  describe('destroy', () => {
    it('should remove instance from registry', () => {
      terminalManager.getOrCreate('test-destroy', defaultOptions, defaultCallbacks)
      expect(terminalManager.has('test-destroy')).toBe(true)

      terminalManager.destroy('test-destroy')
      expect(terminalManager.has('test-destroy')).toBe(false)
    })

    it('should dispose terminal', () => {
      const instance = terminalManager.getOrCreate('test-dispose', defaultOptions, defaultCallbacks)
      terminalManager.destroy('test-dispose')

      expect(instance.terminal.dispose).toHaveBeenCalled()
    })

    it('should do nothing for non-existent id', () => {
      expect(() => terminalManager.destroy('non-existent-3')).not.toThrow()
    })
  })

  describe('resize', () => {
    it('should call terminal.resize', () => {
      const instance = terminalManager.getOrCreate('test-resize', defaultOptions, defaultCallbacks)
      terminalManager.resize('test-resize', 100, 30)

      expect(instance.terminal.resize).toHaveBeenCalledWith(100, 30)
    })

    it('should do nothing for non-existent id', () => {
      expect(() => terminalManager.resize('non-existent-4', 100, 30)).not.toThrow()
    })
  })

  describe('fit', () => {
    it('should call fitAddon.fit and return dimensions on first call', () => {
      const instance = terminalManager.getOrCreate('test-fit', defaultOptions, defaultCallbacks)
      const result = terminalManager.fit('test-fit')

      expect(instance.fitAddon.fit).toHaveBeenCalled()
      expect(result).toEqual({ cols: 80, rows: 24 })
    })

    it('should return null on subsequent calls with same size', () => {
      terminalManager.getOrCreate('test-fit-cache', defaultOptions, defaultCallbacks)
      // 最初の呼び出しはサイズを返す
      const result1 = terminalManager.fit('test-fit-cache')
      expect(result1).toEqual({ cols: 80, rows: 24 })

      // 同じサイズの場合はnullを返す（IPC節約）
      const result2 = terminalManager.fit('test-fit-cache')
      expect(result2).toBeNull()
    })

    it('should return null for non-existent id', () => {
      const result = terminalManager.fit('non-existent-5')
      expect(result).toBeNull()
    })
  })

  describe('focus', () => {
    it('should call terminal.focus', () => {
      const instance = terminalManager.getOrCreate('test-focus', defaultOptions, defaultCallbacks)
      terminalManager.focus('test-focus')

      expect(instance.terminal.focus).toHaveBeenCalled()
    })
  })

  describe('undo/redo', () => {
    it('should return null when undo stack is empty', () => {
      terminalManager.getOrCreate('test-undo-empty', defaultOptions, defaultCallbacks)
      const result = terminalManager.undo('test-undo-empty')

      expect(result).toBeNull()
    })

    it('should return null when redo stack is empty', () => {
      terminalManager.getOrCreate('test-redo-empty', defaultOptions, defaultCallbacks)
      const result = terminalManager.redo('test-redo-empty')

      expect(result).toBeNull()
    })

    it('should undo input and return previous state', () => {
      const instance = terminalManager.getOrCreate('test-undo', defaultOptions, defaultCallbacks)

      // 履歴を手動で設定
      instance.inputHistory.undoStack = ['hel', 'hell']
      instance.inputHistory.currentLine = 'hello'

      const result = terminalManager.undo('test-undo')

      expect(result).toEqual({
        clearCmd: '\x15',
        newText: 'hell'
      })
      expect(instance.inputHistory.currentLine).toBe('hell')
      expect(instance.inputHistory.redoStack).toContain('hello')
    })

    it('should redo input and return next state', () => {
      const instance = terminalManager.getOrCreate('test-redo', defaultOptions, defaultCallbacks)

      // 履歴を手動で設定
      instance.inputHistory.undoStack = ['hel']
      instance.inputHistory.redoStack = ['hello']
      instance.inputHistory.currentLine = 'hell'

      const result = terminalManager.redo('test-redo')

      expect(result).toEqual({
        clearCmd: '\x15',
        newText: 'hello'
      })
      expect(instance.inputHistory.currentLine).toBe('hello')
      expect(instance.inputHistory.undoStack).toContain('hell')
    })

    it('should reset undoRedoInProgress flag after timeout', () => {
      const instance = terminalManager.getOrCreate(
        'test-undo-timeout',
        defaultOptions,
        defaultCallbacks
      )
      instance.inputHistory.undoStack = ['test']
      instance.inputHistory.currentLine = 'test2'

      terminalManager.undo('test-undo-timeout')

      // 300ms後にフラグがリセットされる
      vi.advanceTimersByTime(300)

      // フラグがリセットされたことを確認するため、もう一度undoが動作することを確認
      instance.inputHistory.undoStack = ['a']
      const result = terminalManager.undo('test-undo-timeout')
      expect(result).not.toBeNull()
    })
  })

  describe('clearLine', () => {
    it('should record history and clear current line', () => {
      const instance = terminalManager.getOrCreate('test-clear', defaultOptions, defaultCallbacks)
      instance.inputHistory.currentLine = 'hello world'

      const result = terminalManager.clearLine('test-clear')

      expect(result).toEqual({
        moveToEnd: '\x05',
        clearCmd: '\x15'
      })
      expect(instance.inputHistory.undoStack).toContain('hello world')
      expect(instance.inputHistory.currentLine).toBe('')
    })

    it('should not record empty line', () => {
      const instance = terminalManager.getOrCreate('test-clear-empty', defaultOptions, defaultCallbacks)
      instance.inputHistory.currentLine = ''

      terminalManager.clearLine('test-clear-empty')

      expect(instance.inputHistory.undoStack).toHaveLength(0)
    })
  })

  describe('resetInputHistory', () => {
    it('should clear all history', () => {
      const instance = terminalManager.getOrCreate('test-reset', defaultOptions, defaultCallbacks)
      instance.inputHistory.undoStack = ['a', 'b', 'c']
      instance.inputHistory.redoStack = ['d']
      instance.inputHistory.currentLine = 'current'

      terminalManager.resetInputHistory('test-reset')

      expect(instance.inputHistory.undoStack).toHaveLength(0)
      expect(instance.inputHistory.redoStack).toHaveLength(0)
      expect(instance.inputHistory.currentLine).toBe('')
    })
  })

  describe('selection', () => {
    it('should get selection', () => {
      const instance = terminalManager.getOrCreate('test-selection', defaultOptions, defaultCallbacks)
      ;(instance.terminal.getSelection as ReturnType<typeof vi.fn>).mockReturnValue('selected text')

      const result = terminalManager.getSelection('test-selection')
      expect(result).toBe('selected text')
    })

    it('should clear selection', () => {
      const instance = terminalManager.getOrCreate('test-clear-sel', defaultOptions, defaultCallbacks)
      terminalManager.clearSelection('test-clear-sel')

      expect(instance.terminal.clearSelection).toHaveBeenCalled()
    })

    it('should select current line', () => {
      const instance = terminalManager.getOrCreate('test-select-line', defaultOptions, defaultCallbacks)
      terminalManager.selectCurrentLine('test-select-line')

      expect(instance.terminal.selectLines).toHaveBeenCalledWith(0, 0)
    })
  })
})
