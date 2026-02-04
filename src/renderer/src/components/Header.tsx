import React, { useCallback, useMemo } from 'react'
import {
  useActiveTerminalId,
  useTerminalCount,
  useCanSplit,
  useTerminalActions
} from '../stores/terminalStore'
import { theme } from '../styles/theme'

const Header: React.FC = React.memo(() => {
  const activeTerminalId = useActiveTerminalId()
  const terminalCount = useTerminalCount()
  const canSplit = useCanSplit()
  const { splitTerminal, closeTerminal } = useTerminalActions()

  const canSplitNow = canSplit()
  const canClose = terminalCount > 1

  const handleSplitVertical = useCallback((): void => {
    if (activeTerminalId && canSplitNow) {
      splitTerminal(activeTerminalId, 'horizontal')
    }
  }, [activeTerminalId, canSplitNow, splitTerminal])

  const handleSplitHorizontal = useCallback((): void => {
    if (activeTerminalId && canSplitNow) {
      splitTerminal(activeTerminalId, 'vertical')
    }
  }, [activeTerminalId, canSplitNow, splitTerminal])

  const handleClose = useCallback((): void => {
    if (activeTerminalId && canClose) {
      closeTerminal(activeTerminalId)
    }
  }, [activeTerminalId, canClose, closeTerminal])

  const handleChangeDirectory = useCallback(async (): Promise<void> => {
    if (!activeTerminalId) return

    try {
      const selectedPath = await window.api.dialog.selectDirectory()
      if (selectedPath) {
        const escapedPath = selectedPath.replace(/'/g, "'\\''")
        window.api.pty.write(activeTerminalId, `cd '${escapedPath}'\n`)
      }
    } catch (error) {
      console.error('Failed to change directory:', error)
    }
  }, [activeTerminalId])

  const buttonStyle = useMemo<React.CSSProperties>(
    () => ({
      padding: `${theme.spacing.xs} ${theme.spacing.md}`,
      backgroundColor: 'transparent',
      color: theme.colors.text,
      border: `1px solid ${theme.colors.border}`,
      borderRadius: theme.borderRadius,
      cursor: 'pointer',
      fontSize: '12px',
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing.xs,
      transition: 'background-color 0.15s ease'
    }),
    []
  )

  const disabledStyle = useMemo<React.CSSProperties>(
    () => ({
      ...buttonStyle,
      opacity: 0.5,
      cursor: 'not-allowed'
    }),
    [buttonStyle]
  )

  const closeButtonStyle = useMemo<React.CSSProperties>(
    () =>
      canClose ? { ...buttonStyle, borderColor: theme.colors.danger } : disabledStyle,
    [buttonStyle, disabledStyle, canClose]
  )

  const handleSplitButtonEnter = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (canSplitNow) {
        e.currentTarget.style.backgroundColor = theme.colors.buttonHover
      }
    },
    [canSplitNow]
  )

  const handleButtonLeave = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.backgroundColor = 'transparent'
  }, [])

  const handleCloseButtonEnter = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (canClose) {
        e.currentTarget.style.backgroundColor = theme.colors.danger
        e.currentTarget.style.borderColor = theme.colors.danger
      }
    },
    [canClose]
  )

  const handleCloseButtonLeave = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.currentTarget.style.backgroundColor = 'transparent'
      if (canClose) {
        e.currentTarget.style.borderColor = theme.colors.danger
      }
    },
    [canClose]
  )

  const handleDirectoryButtonEnter = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (activeTerminalId) {
        e.currentTarget.style.backgroundColor = theme.colors.buttonHover
      }
    },
    [activeTerminalId]
  )

  return (
    <header
      className="titlebar-drag-region"
      style={{
        height: theme.headerHeight,
        backgroundColor: theme.colors.headerBackground,
        borderBottom: `1px solid ${theme.colors.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: `0 ${theme.spacing.lg}`,
        paddingLeft: '80px'
      }}
    >
      <div
        style={{
          color: theme.colors.textSecondary,
          fontSize: '13px',
          fontWeight: 500
        }}
      >
        Terminal Division
      </div>

      <div
        className="titlebar-no-drag"
        style={{
          display: 'flex',
          gap: theme.spacing.sm
        }}
      >
        <button
          onClick={handleSplitVertical}
          disabled={!canSplitNow}
          style={canSplitNow ? buttonStyle : disabledStyle}
          title="縦に分割 (Cmd+D)"
          onMouseEnter={handleSplitButtonEnter}
          onMouseLeave={handleButtonLeave}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="12" y1="3" x2="12" y2="21" />
          </svg>
          縦分割
        </button>

        <button
          onClick={handleSplitHorizontal}
          disabled={!canSplitNow}
          style={canSplitNow ? buttonStyle : disabledStyle}
          title="横に分割 (Cmd+Shift+D)"
          onMouseEnter={handleSplitButtonEnter}
          onMouseLeave={handleButtonLeave}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="3" y1="12" x2="21" y2="12" />
          </svg>
          横分割
        </button>

        <button
          onClick={handleChangeDirectory}
          disabled={!activeTerminalId}
          style={activeTerminalId ? buttonStyle : disabledStyle}
          title="ディレクトリを移動"
          onMouseEnter={handleDirectoryButtonEnter}
          onMouseLeave={handleButtonLeave}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            <polyline points="12 11 12 17" />
            <polyline points="9 14 12 11 15 14" />
          </svg>
          ディレクトリ移動
        </button>

        <button
          onClick={handleClose}
          disabled={!canClose}
          style={closeButtonStyle}
          title="閉じる (Cmd+W)"
          onMouseEnter={handleCloseButtonEnter}
          onMouseLeave={handleCloseButtonLeave}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          閉じる
        </button>
      </div>
    </header>
  )
})

Header.displayName = 'Header'

export default Header
