import React from 'react';
import { Stack } from 'expo-router';
import { useTheme } from '../../ui/theme';

export default function SettingsLayout() {
  const t = useTheme();
  return (
    <Stack
      screenOptions={{
        headerTintColor: t.c.text,
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: t.c.grouped },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Settings' }} />
      <Stack.Screen name="memory" options={{ title: 'Memory' }} />
      <Stack.Screen name="instructions" options={{ title: 'Instructions' }} />
    </Stack>
  );
}
