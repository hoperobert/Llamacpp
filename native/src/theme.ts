import { useColorScheme } from 'react-native';

export type Palette = typeof light;

const light = {
  bg: '#ffffff',
  surface: '#ffffff',
  sunken: '#f4f4f4',
  text: '#0d0d0d',
  muted: '#6e6e6e',
  line: '#e3e3e3',
  accent: '#0d0d0d',
  accentText: '#ffffff',
  user: '#f1f1f1',
  danger: '#c62828',
  dark: false,
};

const dark: Palette = {
  bg: '#212121',
  surface: '#2f2f2f',
  sunken: '#171717',
  text: '#ececec',
  muted: '#a3a3a3',
  line: '#3d3d3d',
  accent: '#ffffff',
  accentText: '#0d0d0d',
  user: '#303030',
  danger: '#ff8a80',
  dark: true,
};

export function usePalette(theme: 'auto' | 'light' | 'dark'): Palette {
  const system = useColorScheme();
  const mode = theme === 'auto' ? system : theme;
  return mode === 'dark' ? dark : light;
}
