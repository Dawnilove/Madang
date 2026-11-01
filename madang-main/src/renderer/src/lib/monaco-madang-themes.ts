import type { editor } from 'monaco-editor'
import type { ColorTheme } from '../../../shared/color-theme'

export const MADANG_LIGHT_MONACO_THEME = 'madang-light'
export const MADANG_DARK_MONACO_THEME = 'madang-dark'

// Same hues as the Madang terminal themes; every text color keeps 4.5:1 or more on its background.
const MADANG_LIGHT: editor.IStandaloneThemeData = {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6b645a', fontStyle: 'italic' },
    { token: 'keyword', foreground: '7a4a8f' },
    { token: 'string', foreground: '3b7339' },
    { token: 'number', foreground: '8a5d00' },
    { token: 'type', foreground: '2f5f8f' },
    { token: 'tag', foreground: 'a8432a' },
    { token: 'attribute.name', foreground: '8a5d00' },
    { token: 'delimiter', foreground: '6b645a' }
  ],
  colors: {
    'editor.background': '#fcfaf6',
    'editor.foreground': '#3f3a34',
    'editorGutter.background': '#fcfaf6',
    'editorLineNumber.foreground': '#8a8276',
    'editorLineNumber.activeForeground': '#3f3a34',
    'editor.selectionBackground': '#e0d6bf',
    'editor.inactiveSelectionBackground': '#ede5da',
    'editor.lineHighlightBackground': '#f7f2ec',
    'editorCursor.foreground': '#b44c2d',
    'editorIndentGuide.background1': '#e6ddd0',
    'editorIndentGuide.activeBackground1': '#bfb39a',
    'editorWidget.background': '#fcfaf6',
    'editorWidget.border': '#ddd3c7',
    'editorSuggestWidget.background': '#fcfaf6',
    'editorSuggestWidget.selectedBackground': '#ede5da',
    'editor.findMatchBackground': '#e8c36a99',
    'diffEditor.insertedTextBackground': '#3b733933',
    'diffEditor.removedTextBackground': '#a8432a33',
    'diffEditor.insertedLineBackground': '#3b73391a',
    'diffEditor.removedLineBackground': '#a8432a1a'
  }
}

const MADANG_DARK: editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: 'a39a8c', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'c9a0dc' },
    { token: 'string', foreground: '8fcb8b' },
    { token: 'number', foreground: 'e6b85c' },
    { token: 'type', foreground: '7fb3e0' },
    { token: 'tag', foreground: 'e89a7e' },
    { token: 'attribute.name', foreground: 'e6b85c' },
    { token: 'delimiter', foreground: 'b9ae9c' }
  ],
  colors: {
    'editor.background': '#2b2723',
    'editor.foreground': '#f7f2ec',
    'editorGutter.background': '#2b2723',
    'editorLineNumber.foreground': '#968c7c',
    'editorLineNumber.activeForeground': '#f7f2ec',
    'editor.selectionBackground': '#453e36',
    'editor.inactiveSelectionBackground': '#3a342e',
    'editor.lineHighlightBackground': '#332e29',
    'editorCursor.foreground': '#e08a6b',
    'editorIndentGuide.background1': '#3a342e',
    'editorIndentGuide.activeBackground1': '#5a5046',
    'editorWidget.background': '#332e29',
    'editorWidget.border': '#4a423a',
    'editorSuggestWidget.background': '#332e29',
    'editorSuggestWidget.selectedBackground': '#453e36',
    'editor.findMatchBackground': '#e6b85c66',
    'diffEditor.insertedTextBackground': '#8fcb8b33',
    'diffEditor.removedTextBackground': '#e89a7e33',
    'diffEditor.insertedLineBackground': '#8fcb8b1a',
    'diffEditor.removedLineBackground': '#e89a7e1a'
  }
}

export const MADANG_MONACO_THEMES = {
  [MADANG_LIGHT_MONACO_THEME]: MADANG_LIGHT,
  [MADANG_DARK_MONACO_THEME]: MADANG_DARK
} as const

type MonacoThemeRegistry = {
  editor: { defineTheme: (name: string, data: editor.IStandaloneThemeData) => void }
}

export function registerMadangMonacoThemes(monaco: MonacoThemeRegistry): void {
  for (const [name, data] of Object.entries(MADANG_MONACO_THEMES)) {
    monaco.editor.defineTheme(name, data)
  }
}

/** Madang colors the editor; lime-dark keeps Monaco's built-in themes, as before. */
export function monacoThemeName(isDark: boolean, colorTheme: ColorTheme): string {
  if (colorTheme !== 'lime-dark') {
    return isDark ? MADANG_DARK_MONACO_THEME : MADANG_LIGHT_MONACO_THEME
  }
  return isDark ? 'vs-dark' : 'vs'
}
