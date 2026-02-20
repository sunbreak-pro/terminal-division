import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Header from '../Header'

// terminalStoreモック
const mockSplitTerminal = vi.fn()
const mockCloseTerminal = vi.fn()
const mockSetActiveTerminal = vi.fn()

vi.mock('../../stores/terminalStore', () => ({
  useActiveTerminalId: vi.fn(() => 'terminal-1'),
  useTerminalCount: vi.fn(() => 1),
  useCanSplit: vi.fn(() => () => true),
  useTerminalActions: vi.fn(() => ({
    splitTerminal: mockSplitTerminal,
    closeTerminal: mockCloseTerminal,
    setActiveTerminal: mockSetActiveTerminal,
    getNode: vi.fn()
  }))
}))

// themeStoreモック
const mockSetTheme = vi.fn()

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
    xterm: {}
  }),
  useAvailableThemes: () => [
    { id: 'dark', name: 'Dark', colors: {}, xterm: {} },
    { id: 'light', name: 'Light', colors: {}, xterm: {} }
  ],
  useSetTheme: () => mockSetTheme,
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

// terminalManagerモック
vi.mock('../../services/terminalManager', () => ({
  updateAllThemes: vi.fn()
}))

// terminalStoreモジュールの参照を取得
import * as terminalStore from '../../stores/terminalStore'

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // window.api.dialogのモックをリセット
    vi.mocked(window.api.dialog.selectDirectory).mockResolvedValue(null)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders all buttons', () => {
    render(<Header />)

    expect(screen.getByTitle('縦に分割 (Cmd+D)')).toBeInTheDocument()
    expect(screen.getByTitle('横に分割 (Cmd+Shift+D)')).toBeInTheDocument()
    expect(screen.getByTitle('閉じる (Cmd+W)')).toBeInTheDocument()
    expect(screen.getByTitle('ディレクトリを移動')).toBeInTheDocument()
    expect(screen.getByTitle('ショートカットキー一覧')).toBeInTheDocument()
  })

  it('split buttons disabled when canSplit=false', () => {
    // canSplitがfalseを返すようにモック
    vi.mocked(terminalStore.useCanSplit).mockReturnValue(() => false)

    render(<Header />)

    const verticalSplitButton = screen.getByTitle('縦に分割 (Cmd+D)')
    const horizontalSplitButton = screen.getByTitle('横に分割 (Cmd+Shift+D)')

    expect(verticalSplitButton).toBeDisabled()
    expect(horizontalSplitButton).toBeDisabled()
  })

  it('close button disabled when single terminal', () => {
    // ターミナルが1つの場合
    vi.mocked(terminalStore.useTerminalCount).mockReturnValue(1)
    vi.mocked(terminalStore.useCanSplit).mockReturnValue(() => true)

    render(<Header />)

    const closeButton = screen.getByTitle('閉じる (Cmd+W)')
    expect(closeButton).toBeDisabled()
  })

  it('close button enabled when multiple terminals', () => {
    // ターミナルが2つ以上の場合
    vi.mocked(terminalStore.useTerminalCount).mockReturnValue(2)
    vi.mocked(terminalStore.useCanSplit).mockReturnValue(() => true)

    render(<Header />)

    const closeButton = screen.getByTitle('閉じる (Cmd+W)')
    expect(closeButton).not.toBeDisabled()
  })

  it('calls splitTerminal("horizontal") on vertical split button click', () => {
    vi.mocked(terminalStore.useCanSplit).mockReturnValue(() => true)

    render(<Header />)

    const verticalSplitButton = screen.getByTitle('縦に分割 (Cmd+D)')
    fireEvent.click(verticalSplitButton)

    expect(mockSplitTerminal).toHaveBeenCalledWith('terminal-1', 'horizontal')
  })

  it('calls splitTerminal("vertical") on horizontal split button click', () => {
    vi.mocked(terminalStore.useCanSplit).mockReturnValue(() => true)

    render(<Header />)

    const horizontalSplitButton = screen.getByTitle('横に分割 (Cmd+Shift+D)')
    fireEvent.click(horizontalSplitButton)

    expect(mockSplitTerminal).toHaveBeenCalledWith('terminal-1', 'vertical')
  })

  it('calls closeTerminal on close button click', () => {
    vi.mocked(terminalStore.useTerminalCount).mockReturnValue(2)
    vi.mocked(terminalStore.useCanSplit).mockReturnValue(() => true)

    render(<Header />)

    const closeButton = screen.getByTitle('閉じる (Cmd+W)')
    fireEvent.click(closeButton)

    expect(mockCloseTerminal).toHaveBeenCalledWith('terminal-1')
  })

  it('theme selector changes theme', () => {
    vi.mocked(terminalStore.useCanSplit).mockReturnValue(() => true)

    render(<Header />)

    const themeSelect = screen.getByTitle('テーマ選択')
    fireEvent.change(themeSelect, { target: { value: 'light' } })

    expect(mockSetTheme).toHaveBeenCalledWith('light')
  })

  it('opens/closes shortcuts modal', () => {
    vi.mocked(terminalStore.useCanSplit).mockReturnValue(() => true)

    render(<Header />)

    // モーダルは初期状態で非表示
    expect(screen.queryByText('ショートカットキー一覧')).not.toBeInTheDocument()

    // ショートカットボタンをクリック
    const shortcutsButton = screen.getByTitle('ショートカットキー一覧')
    fireEvent.click(shortcutsButton)

    // モーダルが表示される
    expect(screen.getByText('ショートカットキー一覧')).toBeInTheDocument()

    // ×ボタンでモーダルを閉じる
    const closeModalButton = screen.getByText('×')
    fireEvent.click(closeModalButton)

    // モーダルが非表示になる
    expect(screen.queryByText('ショートカットキー一覧')).not.toBeInTheDocument()
  })

  it('calls directory selection dialog on directory button click', async () => {
    vi.mocked(terminalStore.useCanSplit).mockReturnValue(() => true)
    vi.mocked(window.api.dialog.selectDirectory).mockResolvedValue('/some/path')

    render(<Header />)

    const directoryButton = screen.getByTitle('ディレクトリを移動')
    fireEvent.click(directoryButton)

    await waitFor(() => {
      expect(window.api.dialog.selectDirectory).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(window.api.pty.write).toHaveBeenCalledWith('terminal-1', "cd '/some/path'\n")
    })
  })

  it('directory button disabled when no active terminal', () => {
    vi.mocked(terminalStore.useActiveTerminalId).mockReturnValue(null)
    vi.mocked(terminalStore.useCanSplit).mockReturnValue(() => true)

    render(<Header />)

    const directoryButton = screen.getByTitle('ディレクトリを移動')
    expect(directoryButton).toBeDisabled()
  })
})
