import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ShortcutsModal from '../ShortcutsModal'

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
    xterm: {}
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

describe('ShortcutsModal', () => {
  const mockOnClose = vi.fn()

  beforeEach(() => {
    mockOnClose.mockClear()
  })

  it('does not render when closed', () => {
    const { container } = render(
      <ShortcutsModal isOpen={false} onClose={mockOnClose} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders when open', () => {
    render(<ShortcutsModal isOpen={true} onClose={mockOnClose} />)
    expect(screen.getByText('ショートカットキー一覧')).toBeInTheDocument()
  })

  it('shows all shortcut categories', () => {
    render(<ShortcutsModal isOpen={true} onClose={mockOnClose} />)

    // 4つのカテゴリが表示されていることを確認
    expect(screen.getByText('Terminal Management')).toBeInTheDocument()
    expect(screen.getByText('Navigation')).toBeInTheDocument()
    expect(screen.getByText('Line Editing')).toBeInTheDocument()
    expect(screen.getByText('Word Editing')).toBeInTheDocument()
  })

  it('closes on backdrop click', () => {
    const { container } = render(<ShortcutsModal isOpen={true} onClose={mockOnClose} />)

    // オーバーレイ（背景）をクリック - 一番外側のdiv
    const overlay = container.firstChild as HTMLElement
    fireEvent.click(overlay)

    expect(mockOnClose).toHaveBeenCalledTimes(1)
  })

  it('closes on ESC key', () => {
    render(<ShortcutsModal isOpen={true} onClose={mockOnClose} />)

    // ESCキーを押す
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(mockOnClose).toHaveBeenCalledTimes(1)
  })

  it('closes on X button click', () => {
    render(<ShortcutsModal isOpen={true} onClose={mockOnClose} />)

    // ×ボタンをクリック
    const closeButton = screen.getByText('×')
    fireEvent.click(closeButton)

    expect(mockOnClose).toHaveBeenCalledTimes(1)
  })

  it('content click does not close', () => {
    render(<ShortcutsModal isOpen={true} onClose={mockOnClose} />)

    // モーダルコンテンツ内をクリック
    const title = screen.getByText('ショートカットキー一覧')
    fireEvent.click(title)

    expect(mockOnClose).not.toHaveBeenCalled()
  })
})
