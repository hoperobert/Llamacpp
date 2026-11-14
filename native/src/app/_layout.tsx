import React, { useEffect } from 'react';
import { Appearance } from 'react-native';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { app, start } from '../lib/app';
import { useTheme } from '../ui/theme';

export default function RootLayout() {
  const t = useTheme();
  const choice = app.use((s) => s.settings.theme);

  useEffect(() => { start(); }, []);

  // Make the system's own controls (sheets, switches, menus) follow the theme
  // chosen in Settings, not only the parts this app draws.
  useEffect(() => { Appearance.setColorScheme?.(choice); }, [choice]);

  const base = t.c.dark ? DarkTheme : DefaultTheme;
  const theme = {
    ...base,
    colors: {
      ...base.colors,
      background: t.c.bg, card: t.c.bg, text: t.c.text, primary: t.c.text, border: t.c.line,
    },
  };

  return (
    <ThemeProvider value={theme}>
      <StatusBar style={t.c.dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerTintColor: t.c.text, headerShadowVisible: false }}>
        <Stack.Screen name="index" options={{ title: '', headerTransparent: true }} />
        <Stack.Screen name="chats" options={{ title: 'Chats', presentation: 'modal' }} />
        <Stack.Screen name="models" options={{ title: 'Models', presentation: 'modal' }} />
        <Stack.Screen name="settings" options={{ headerShown: false, presentation: 'modal' }} />
      </Stack>
    </ThemeProvider>
  );
}
