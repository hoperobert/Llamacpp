// Colours and type. A warm, quiet palette with a black and white accent. Text
// is the system face; the serif is kept for the greeting.

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
  accent: '#1a1915',
  onAccent: '#ffffff',
  danger: '#b3261e',
  good: '#3f7d4e',
  warn: '#a8620b',
};

const dark: Palette = {
  dark: true,
  bg: '#1c1c1a',
  grouped: '#161615',
  card: '#272725',
  fill: '#2f2f2d',
  text: '#f5f4ee',
  secondary: '#a3a199',
  tertiary: '#6f6d67',
  line: '#3a3a37',
  accent: '#f5f4ee',
  onAccent: '#1c1c1a',
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
