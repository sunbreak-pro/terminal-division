// テーマ型定義
export interface XtermTheme {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  selectionForeground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

export interface AppColors {
  background: string
  headerBackground: string
  terminalBackground: string
  text: string
  textSecondary: string
  accent: string
  activeTerminal: string
  border: string
  borderActive: string
  buttonHover: string
  danger: string
}

export interface Theme {
  id: string
  name: string
  colors: AppColors
  xterm: XtermTheme
}

export interface ThemeConfig {
  spacing: {
    xs: string
    sm: string
    md: string
    lg: string
    xl: string
  }
  borderRadius: string
  headerHeight: string
}

// 共通設定（テーマ間で変わらない）
export const themeConfig: ThemeConfig = {
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '24px'
  },
  borderRadius: '4px',
  headerHeight: '40px'
}

// テーマプリセット
export const themes: Record<string, Theme> = {
  dark: {
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
      foreground: '#d4d4d4',
      cursor: '#d4d4d4',
      cursorAccent: '#0d0d0d',
      selectionBackground: '#264f78',
      selectionForeground: '#ffffff',
      black: '#000000',
      red: '#cd3131',
      green: '#0dbc79',
      yellow: '#e5e510',
      blue: '#2472c8',
      magenta: '#bc3fbc',
      cyan: '#11a8cd',
      white: '#e5e5e5',
      brightBlack: '#666666',
      brightRed: '#f14c4c',
      brightGreen: '#23d18b',
      brightYellow: '#f5f543',
      brightBlue: '#3b8eea',
      brightMagenta: '#d670d6',
      brightCyan: '#29b8db',
      brightWhite: '#ffffff'
    }
  },

  light: {
    id: 'light',
    name: 'Light',
    colors: {
      background: '#f5f5f5',
      headerBackground: '#e8e8e8',
      terminalBackground: '#ffffff',
      text: '#333333',
      textSecondary: '#666666',
      accent: '#0066cc',
      activeTerminal: '#ff8c00',
      border: '#d4d4d4',
      borderActive: '#0066cc',
      buttonHover: '#d4d4d4',
      danger: '#d32f2f'
    },
    xterm: {
      background: '#ffffff',
      foreground: '#333333',
      cursor: '#333333',
      cursorAccent: '#ffffff',
      selectionBackground: '#add6ff',
      selectionForeground: '#000000',
      black: '#000000',
      red: '#c91b00',
      green: '#00a600',
      yellow: '#c7c400',
      blue: '#0225c7',
      magenta: '#c930c7',
      cyan: '#00a6b2',
      white: '#bfbfbf',
      brightBlack: '#676767',
      brightRed: '#ff6d67',
      brightGreen: '#5ff967',
      brightYellow: '#fefb67',
      brightBlue: '#6871ff',
      brightMagenta: '#ff76ff',
      brightCyan: '#5ffdff',
      brightWhite: '#feffff'
    }
  },

  dracula: {
    id: 'dracula',
    name: 'Dracula',
    colors: {
      background: '#282a36',
      headerBackground: '#21222c',
      terminalBackground: '#1e1f29',
      text: '#f8f8f2',
      textSecondary: '#6272a4',
      accent: '#bd93f9',
      activeTerminal: '#ff79c6',
      border: '#44475a',
      borderActive: '#bd93f9',
      buttonHover: '#44475a',
      danger: '#ff5555'
    },
    xterm: {
      background: '#1e1f29',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      cursorAccent: '#1e1f29',
      selectionBackground: '#44475a',
      selectionForeground: '#f8f8f2',
      black: '#21222c',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#bd93f9',
      magenta: '#ff79c6',
      cyan: '#8be9fd',
      white: '#f8f8f2',
      brightBlack: '#6272a4',
      brightRed: '#ff6e6e',
      brightGreen: '#69ff94',
      brightYellow: '#ffffa5',
      brightBlue: '#d6acff',
      brightMagenta: '#ff92df',
      brightCyan: '#a4ffff',
      brightWhite: '#ffffff'
    }
  },

  oneDark: {
    id: 'oneDark',
    name: 'One Dark',
    colors: {
      background: '#21252b',
      headerBackground: '#282c34',
      terminalBackground: '#1e2127',
      text: '#abb2bf',
      textSecondary: '#5c6370',
      accent: '#61afef',
      activeTerminal: '#e5c07b',
      border: '#3e4451',
      borderActive: '#61afef',
      buttonHover: '#3e4451',
      danger: '#e06c75'
    },
    xterm: {
      background: '#1e2127',
      foreground: '#abb2bf',
      cursor: '#528bff',
      cursorAccent: '#1e2127',
      selectionBackground: '#3e4451',
      selectionForeground: '#abb2bf',
      black: '#1e2127',
      red: '#e06c75',
      green: '#98c379',
      yellow: '#e5c07b',
      blue: '#61afef',
      magenta: '#c678dd',
      cyan: '#56b6c2',
      white: '#abb2bf',
      brightBlack: '#5c6370',
      brightRed: '#e06c75',
      brightGreen: '#98c379',
      brightYellow: '#e5c07b',
      brightBlue: '#61afef',
      brightMagenta: '#c678dd',
      brightCyan: '#56b6c2',
      brightWhite: '#ffffff'
    }
  }
}

// デフォルトテーマID
export const DEFAULT_THEME_ID = 'dark'

// 後方互換性のためのエクスポート（既存コードが壊れないように）
export const theme = {
  colors: themes[DEFAULT_THEME_ID].colors,
  spacing: themeConfig.spacing,
  borderRadius: themeConfig.borderRadius,
  headerHeight: themeConfig.headerHeight
}

export const xtermTheme = themes[DEFAULT_THEME_ID].xterm
