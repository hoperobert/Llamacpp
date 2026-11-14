// Colours and type. A warm, paper-like palette with one clay accent, and a
// serif face for headings and replies.

import { useMemo } from 'react';
import { Platform, useColorScheme } from 'react-native';
import { app } from '../lib/app';

const light = {
  dark: false,
  bg: '#faf9f5',
  /** Background of settings-style screens and the side menu. */
  grouped: '#f3f1e9',
  /** Rows and cards on a grouped background, and the message box. */
  card: '#ffffff',
  /** Quiet filled areas: the user's bubble, code blocks, buttons. */
  fill: '#efede4',
  text: '#1a1915',
  secondary: '#6f6d64',
  tertiary: '#a9a69b',
  line: '#e2dfd3',
  accent: '#c96442',
  onAccent: '#ffffff',
  danger: '#b3261e',
  good: '#3f7d4e',
  warn: '#a8620b',
};

const dark: Palette = {
  dark: true,
  bg: '#262624',
  grouped: '#1f1e1d',
  card: '#30302e',
  fill: '#3a3a37',
  text: '#f5f4ee',
  secondary: '#a8a59c',
  tertiary: '#76746d',
  line: '#43423f',
  accent: '#d97757',
  onAccent: '#ffffff',
  danger: '#f2776b',
  good: '#7fbf8e',
  warn: '#e0a458',
};

export type Palette = typeof light;

const SIZES = { small: 15, medium: 17, large: 19 } as const;

/** The system serif (New York) on iOS. */
export const serif = Platform.select({ ios: 'ui-serif', default: 'Georgia' });

export type Theme = { c: Palette; size: number };

export function useTheme(): Theme {
  const system = useColorScheme();
  const choice = app.use((s) => s.settings.theme);
  const textSize = app.use((s) => s.settings.textSize);
  const isDark = (choice === 'auto' ? system : choice) === 'dark';
  // The same object while nothing changes, so memoised rows are not redrawn.
  return useMemo(() => ({ c: isDark ? dark : light, size: SIZES[textSize] }), [isDark, textSize]);
}
