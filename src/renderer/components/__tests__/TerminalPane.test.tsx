import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TerminalPane from '../TerminalPane'

// terminalManagerモック
const mockGetOrCreate = vi.fn()
const mockAttachToContainer = vi.fn()
const mockDetachFromContainer = vi.fn()
const mockFocus = vi.fn()
const mockFit = vi.fn()

vi.mock('../../services/terminalManager', () => ({
  getOrCreate: (...args: unknown[]) => mockGetOrCreate(...args),
  attachToContainer: (...args: unknown[]) => mockAttachToContainer(...args),
  detachFromContainer: (...args: unknown[]) => mockDetachFromContainer(...args),
  focus: (...args: unknown[]) => mockFocus(...args),
  fit: (...args: unknown[]) => mockFit(...args)
}))

// terminalStoreモック
const mockSetActiveTerminal = vi.fn()
const mockCloseTerminal = vi.fn()

vi.mock('../../stores/terminalStore', () => ({
  useActiveTerminalId: vi.fn(() => 'terminal-1'),
  useTerminalActions: vi.fn(() => ({
    setActiveTerminal: mockSetActiveTerminal,
    closeTerminal: mockCloseTerminal
  }))
}))

// themeStoreモック
vi.mock('../../stores/themeStore', () => ({
  useCurrentTheme: () => ({
    id: 'dark',
    name: 'Dark',
    colors: {
      background: '#1a1a1a',
      headerBackground: '#252526',
      terminalBackground: '#0d0d0d',
      text: '#d4d4d4',
      textSecondary: '#888888',
      accent: '#007acc',
      activeTerminal: '#ff8c00',
      border: '#515050',
      borderActive: '#007acc',
      buttonHover: '#3c3c3c',
      danger: '#f44747'
    },
    xterm: {
      background: '#0d0d0d',
      foreground: '#d4d4d4'
    }
  }),
  useThemeConfig: () => ({
    spacing: {
      xs: '4px',
      sm: '8px',
      md: '12px',
      lg: '16px',
      xl: '24px'
    },
    borderRadius: '4px',
    headerHeight: '40px'
  })
}))

// rafDebounceモック
vi.mock('../../utils/rafDebounce', () => ({
  rafDebounceWithDelay: (fn: () => void) => ({
    handler: fn,
    cancel: vi.fn()
  })
}))

import * as terminalStore from '../../stores/terminalStore'

describe('TerminalPane', () => {
  const mockTerminalInstance = {
    terminal: {
      cols: 80,
      rows: 24
    },
    fitAddon: {
      fit: vi.fn()
    },
    ptyCreated: false
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    // デフォルトのモック設定
    mockGetOrCreate.mockReturnValue(mockTerminalInstance)
    mockFit.mockReturnValue({ cols: 80, rows: 24 })
    vi.mocked(terminalStore.useActiveTerminalId).mockReturnValue('terminal-1')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('calls getOrCreate on mount', () => {
    render(<TerminalPane id="terminal-1" />)

    expect(mockGetOrCreate).toHaveBeenCalledWith(
      'terminal-1',
      expect.objectContaining({
        fontFamily: expect.any(String),
        fontSize: 13,
        cursorBlink: true
      }),
      expect.objectContaining({
        onData: expect.any(Function),
        onExit: expect.any(Function)
      })
    )
  })

  it('attaches to container on mount', () => {
    render(<TerminalPane id="terminal-1" />)

    expect(mockAttachToContainer).toHaveBeenCalledWith(
      'terminal-1',
      expect.any(HTMLDivElement)
    )
  })

  it('focuses terminal when active', () => {
    // このターミナルがアクティブ状態で描画
    vi.mocked(terminalStore.useActiveTerminalId).mockReturnValue('terminal-1')

    render(<TerminalPane id="terminal-1" />)

    // isActive === true のため、useEffectでfocusが呼ばれる
    expect(mockFocus).toHaveBeenCalledWith('terminal-1')
  })

  it('sets active on click', () => {
    vi.mocked(terminalStore.useActiveTerminalId).mockReturnValue('terminal-2')

    const { container } = render(<TerminalPane id="terminal-1" />)

    const terminalContainer = container.querySelector('.terminal-container')!
    fireEvent.click(terminalContainer)

    expect(mockSetActiveTerminal).toHaveBeenCalledWith('terminal-1')
    expect(mockFocus).toHaveBeenCalledWith('terminal-1')
  })

  it('applies active border style when active', () => {
    vi.mocked(terminalStore.useActiveTerminalId).mockReturnValue('terminal-1')

    const { container } = render(<TerminalPane id="terminal-1" />)

    const terminalContainer = container.querySelector('.terminal-container')
    // アクティブ時は3pxボーダー (rgb(255, 140, 0) = #ff8c00)
    expect(terminalContainer?.style.border).toContain('3px')
    expect(terminalContainer?.style.border).toMatch(/rgb\(255,\s*140,\s*0\)/)
  })

  it('applies inactive border style when not active', () => {
    vi.mocked(terminalStore.useActiveTerminalId).mockReturnValue('terminal-2')

    const { container } = render(<TerminalPane id="terminal-1" />)

    const terminalContainer = container.querySelector('.terminal-container')
    // 非アクティブ時は2pxボーダー (rgb(81, 80, 80) = #515050)
    expect(terminalContainer?.style.border).toContain('2px')
    expect(terminalContainer?.style.border).toMatch(/rgb\(81,\s*80,\s*80\)/)
  })

  it('cleanup on unmount', () => {
    const { unmount } = render(<TerminalPane id="terminal-1" />)

    unmount()

    expect(mockDetachFromContainer).toHaveBeenCalledWith('terminal-1')
  })

  it('creates PTY on first mount', () => {
    mockTerminalInstance.ptyCreated = false

    render(<TerminalPane id="terminal-1" />)

    // setTimeout内の処理を実行
    vi.runAllTimers()

    expect(window.api.pty.create).toHaveBeenCalledWith('terminal-1')
  })

  it('does not create PTY if already created', () => {
    // PTYが既に作成済みの状態
    const instanceWithPty = {
      ...mockTerminalInstance,
      ptyCreated: true
    }
    mockGetOrCreate.mockReturnValue(instanceWithPty)

    render(<TerminalPane id="terminal-1" />)

    // setTimeout内の処理を実行
    vi.runAllTimers()

    // createは呼ばれない
    expect(window.api.pty.create).not.toHaveBeenCalled()
  })
})
