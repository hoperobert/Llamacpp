// Colours and type sizes. The palette follows the iOS system greys, with a
// black and white accent, so the app sits naturally next to Apple's own.

import { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { app } from '../lib/app';

const light = {
  dark: false,
  bg: '#ffffff',
  /** Background of settings-style screens. */
  grouped: '#f2f2f7',
  /** Rows and cards on a grouped background. */
  card: '#ffffff',
  /** Quiet filled areas: the message box, code blocks, the user's bubble. */
  fill: '#f0f0f3',
  text: '#000000',
  secondary: '#6e6e73',
  tertiary: '#aeaeb2',
  line: '#d9d9de',
  accent: '#000000',
  onAccent: '#ffffff',
  danger: '#ff3b30',
  good: '#248a3d',
  warn: '#b25000',
};

const dark: Palette = {
  dark: true,
  bg: '#000000',
  grouped: '#000000',
  card: '#1c1c1e',
  fill: '#1c1c1e',
  text: '#ffffff',
  secondary: '#98989f',
  tertiary: '#636366',
  line: '#38383a',
  accent: '#ffffff',
  onAccent: '#000000',
  danger: '#ff453a',
  good: '#30d158',
  warn: '#ff9f0a',
};

export type Palette = typeof light;

const SIZES = { small: 15, medium: 17, large: 19 } as const;

export type Theme = { c: Palette; size: number };

export function useTheme(): Theme {
  const system = useColorScheme();
  const choice = app.use((s) => s.settings.theme);
  const textSize = app.use((s) => s.settings.textSize);
  const isDark = (choice === 'auto' ? system : choice) === 'dark';
  // The same object while nothing changes, so memoised rows are not redrawn.
  return useMemo(() => ({ c: isDark ? dark : light, size: SIZES[textSize] }), [isDark, textSize]);
}
