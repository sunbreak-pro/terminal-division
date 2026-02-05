import React, { useEffect, useRef, useCallback, useMemo } from 'react'
import '@xterm/xterm/css/xterm.css'
import { useActiveTerminalId, useTerminalActions } from '../stores/terminalStore'
import { theme, xtermTheme } from '../styles/theme'
import * as terminalManager from '../services/terminalManager'

interface TerminalPaneProps {
  id: string
}

const TerminalPane: React.FC<TerminalPaneProps> = React.memo(({ id }) => {
  const containerRef = useRef<HTMLDivElement>(null)

  const activeTerminalId = useActiveTerminalId()
  const { setActiveTerminal, closeTerminal } = useTerminalActions()
  const isActive = activeTerminalId === id

  // Focus terminal when it becomes active
  useEffect(() => {
    if (isActive) {
      terminalManager.focus(id)
    }
  }, [isActive, id])

  const handleFit = useCallback(() => {
    const result = terminalManager.fit(id)
    if (result) {
      window.api.pty.resize(id, result.cols, result.rows)
    }
  }, [id])

  useEffect(() => {
    if (!containerRef.current) return

    // 1. Get or create terminal instance (callbacks are registered ONCE during creation)
    const instance = terminalManager.getOrCreate(
      id,
      {
        theme: xtermTheme,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        fontSize: 13,
        lineHeight: 1.2,
        cursorBlink: true,
        cursorStyle: 'block',
        allowTransparency: true,
        scrollback: 10000
      },
      {
        onData: (data) => {
          window.api.pty.write(id, data)
        },
        onExit: () => {
          closeTerminal(id)
        }
      }
    )

    // 2. Attach to DOM container
    terminalManager.attachToContainer(id, containerRef.current)

    // 3. Set up PTY (only if not already created)
    if (!instance.ptyCreated) {
      // Mark as created IMMEDIATELY (before setTimeout) to prevent duplicate registration
      instance.ptyCreated = true

      // Create PTY after DOM is ready
      setTimeout(() => {
        instance.fitAddon.fit()
        const { cols, rows } = instance.terminal

        window.api.pty
          .create(id)
          .then(() => {
            window.api.pty.resize(id, cols, rows)
          })
          .catch((error) => {
            console.error(`Failed to create PTY for terminal ${id}:`, error)
            instance.terminal.write('\r\n\x1b[31mError: Failed to create terminal process\x1b[0m\r\n')
          })
      }, 0)
    } else {
      // Terminal already exists, just fit it
      setTimeout(() => {
        handleFit()
      }, 0)
    }

    // 4. Set up ResizeObserver with debounce
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimeout) clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(() => {
        handleFit()
      }, 100)
    })
    resizeObserver.observe(containerRef.current)

    // Cleanup: only disconnect observer, do NOT dispose terminal or kill PTY
    return () => {
      if (resizeTimeout) clearTimeout(resizeTimeout)
      resizeObserver.disconnect()
      terminalManager.detachFromContainer(id)
    }
  }, [id, closeTerminal])

  const handleClick = useCallback((): void => {
    setActiveTerminal(id)
    terminalManager.focus(id)
  }, [id, setActiveTerminal])

  // Memoize container style
  const containerStyle = useMemo(
    () => ({
      height: '100%',
      width: '100%',
      position: 'relative' as const,
      boxSizing: 'border-box' as const,
      border: isActive ? `1.5px solid ${theme.colors.activeTerminal}` : '1.5px solid transparent'
    }),
    [isActive]
  )

  return (
    <div className="terminal-container" onClick={handleClick} style={containerStyle}>
      <div
        ref={containerRef}
        style={{
          height: '100%',
          width: '100%'
        }}
      />
    </div>
  )
})

TerminalPane.displayName = 'TerminalPane'

export default TerminalPane
