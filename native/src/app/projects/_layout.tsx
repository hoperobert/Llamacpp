import React from 'react';
import { Stack } from 'expo-router';
import { useTheme } from '../../ui/theme';

export default function ProjectsLayout() {
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
      <Stack.Screen name="index" options={{ title: 'Projects' }} />
      <Stack.Screen name="[id]" options={{ title: '' }} />
    </Stack>
  );
}
