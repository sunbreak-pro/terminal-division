import React, { useEffect, useCallback } from 'react'
import { useCurrentTheme, useThemeConfig } from '../stores/themeStore'

interface ShortcutsModalProps {
  isOpen: boolean
  onClose: () => void
}

interface ShortcutItem {
  keys: string
  description: string
}

interface ShortcutCategory {
  title: string
  shortcuts: ShortcutItem[]
}

const shortcutCategories: ShortcutCategory[] = [
  {
    title: 'Terminal Management',
    shortcuts: [
      { keys: '⌘ D', description: '縦に分割' },
      { keys: '⌘ ⇧ D', description: '横に分割' },
      { keys: '⌘ W', description: '現在のターミナルを閉じる' }
    ]
  },
  {
    title: 'Navigation',
    shortcuts: [
      { keys: '⌘ ⌥ ←', description: '左のターミナルに移動' },
      { keys: '⌘ ⌥ →', description: '右のターミナルに移動' },
      { keys: '⌘ ⌥ ↑', description: '上のターミナルに移動' },
      { keys: '⌘ ⌥ ↓', description: '下のターミナルに移動' }
    ]
  },
  {
    title: 'Line Editing',
    shortcuts: [
      { keys: '⌘ ⌫', description: 'カーソル位置から行頭まで削除' },
      { keys: '⌘ K', description: 'カーソル位置から行末まで削除' },
      { keys: '⌘ ←', description: '行頭に移動' },
      { keys: '⌘ →', description: '行末に移動' },
      { keys: '⇧ Enter', description: '改行を挿入（コマンド実行なし）' }
    ]
  },
  {
    title: 'Word Editing',
    shortcuts: [
      { keys: '⌥ ⌫', description: '前の単語を削除' },
      { keys: '⌥ D', description: '次の単語を削除' },
      { keys: '⌥ ←', description: '前の単語に移動' },
      { keys: '⌥ →', description: '次の単語に移動' }
    ]
  }
]

const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ isOpen, onClose }) => {
  const currentTheme = useCurrentTheme()
  const themeConfig = useThemeConfig()
  const theme = { colors: currentTheme.colors, ...themeConfig }

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    },
    [onClose]
  )

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, handleKeyDown])

  if (!isOpen) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: theme.colors.headerBackground,
          borderRadius: '8px',
          border: `1px solid ${theme.colors.border}`,
          padding: theme.spacing.xl,
          maxWidth: '600px',
          width: '90%',
          maxHeight: '80vh',
          overflow: 'auto'
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: theme.spacing.lg
          }}
        >
          <h2
            style={{
              margin: 0,
              color: theme.colors.text,
              fontSize: '18px',
              fontWeight: 600
            }}
          >
            ショートカットキー一覧
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: theme.colors.textSecondary,
              cursor: 'pointer',
              fontSize: '20px',
              padding: theme.spacing.xs,
              lineHeight: 1
            }}
          >
            ×
          </button>
        </div>

        {shortcutCategories.map((category) => (
          <div key={category.title} style={{ marginBottom: theme.spacing.lg }}>
            <h3
              style={{
                margin: 0,
                marginBottom: theme.spacing.sm,
                color: theme.colors.accent,
                fontSize: '14px',
                fontWeight: 500
              }}
            >
              {category.title}
            </h3>
            <div
              style={{
                backgroundColor: theme.colors.background,
                borderRadius: theme.borderRadius,
                padding: theme.spacing.sm
              }}
            >
              {category.shortcuts.map((shortcut, index) => (
                <div
                  key={shortcut.keys}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
                    borderBottom:
                      index < category.shortcuts.length - 1
                        ? `1px solid ${theme.colors.border}`
                        : 'none'
                  }}
                >
                  <span
                    style={{
                      color: theme.colors.text,
                      fontSize: '13px'
                    }}
                  >
                    {shortcut.description}
                  </span>
                  <kbd
                    style={{
                      backgroundColor: theme.colors.headerBackground,
                      border: `1px solid ${theme.colors.border}`,
                      borderRadius: '4px',
                      padding: `2px ${theme.spacing.sm}`,
                      fontSize: '12px',
                      fontFamily: 'monospace',
                      color: theme.colors.text,
                      minWidth: '80px',
                      textAlign: 'center'
                    }}
                  >
                    {shortcut.keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        ))}

        <p
          style={{
            margin: 0,
            marginTop: theme.spacing.md,
            color: theme.colors.textSecondary,
            fontSize: '12px',
            textAlign: 'center'
          }}
        >
          ESC キーまたはオーバーレイクリックで閉じる
        </p>
      </div>
    </div>
  )
}

export default ShortcutsModal
