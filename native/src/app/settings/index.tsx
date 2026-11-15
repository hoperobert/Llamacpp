import { hasNative } from '../../../modules/pocket-native';
import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Stack, useRouter } from 'expo-router';
import {
  app, changeSettings, deleteAllChats, deleteAllMemories, exportEverything, findModel,
} from '../../lib/app';
import { ramMB } from '../../lib/device';
import { engineVersion } from '../../lib/engine';
import { ChoiceRow, Row, Section, SwitchRow } from '../../ui/List';
import { useTheme } from '../../ui/theme';

export default function SettingsScreen() {
  const t = useTheme();
  const router = useRouter();
  const settings = app.use((s) => s.settings);
  const memories = app.use((s) => s.memories);
  const engine = app.use((s) => s.engine);
  const chatCount = app.use((s) => s.chatList.length);
  const lastClose = app.use((s) => s.lastClose);
  const lastError = app.use((s) => s.lastError);
  const model = findModel(engine.modelId);

  return (
    <>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
      </Stack.Toolbar>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.body}>
        <Section t={t}>
          <Row
            t={t} icon="cpu" title="Model"
            value={engine.status === 'ready' && model ? model.name : engine.status === 'loading' ? 'Loading…' : 'None'}
            chevron onPress={() => router.push('/models')}
          />
          <Row
            t={t} icon="text.bubble" title="Instructions"
            value={settings.instructions.trim() ? 'On' : 'Off'}
            chevron onPress={() => router.push('/settings/instructions')}
          />
          <Row
            t={t} icon="brain" title="Memory"
            value={settings.memoryOn ? String(memories.length) : 'Off'}
            chevron onPress={() => router.push('/settings/memory')}
          />
        </Section>

        <Section t={t} title="Replies">
          <ChoiceRow
            t={t} title="Style" value={settings.temperature}
            onChange={(temperature) => changeSettings({ temperature })}
            options={[{ label: 'Precise', value: 0.2 }, { label: 'Balanced', value: 0.7 }, { label: 'Creative', value: 1.1 }]}
          />
          <ChoiceRow
            t={t} title="Length" value={settings.maxTokens}
            onChange={(maxTokens) => changeSettings({ maxTokens })}
            options={[{ label: 'Short', value: 256 }, { label: 'Medium', value: 768 }, { label: 'Long', value: 1536 }, { label: 'Max', value: 3072 }]}
          />
          <SwitchRow t={t} title="Think first" value={settings.thinking} onChange={(thinking) => changeSettings({ thinking })} />
          <SwitchRow
            t={t} title="Do things on this iPhone"
            value={settings.assistant} onChange={(assistant) => changeSettings({ assistant })}
          />
          {hasNative && (
            <SwitchRow
              t={t} title="Finish in the background"
              value={settings.background} onChange={(background) => changeSettings({ background })}
            />
          )}
        </Section>

        <Section t={t} title="Context">
          <ChoiceRow
            // Auto picks a size for each model that fits this iPhone.
            t={t} title="Size" value={settings.autoContext ? 0 : settings.nCtx}
            onChange={(size) => changeSettings(size ? { autoContext: false, nCtx: size } : { autoContext: true })}
            options={[{ label: 'Auto', value: 0 }, { label: '2K', value: 2048 }, { label: '4K', value: 4096 }, { label: '8K', value: 8192 }]}
          />
          <SwitchRow t={t} title="Summarise long chats" value={settings.autoSummary} onChange={(autoSummary) => changeSettings({ autoSummary })} />
          <SwitchRow t={t} title="Name chats" value={settings.autoTitle} onChange={(autoTitle) => changeSettings({ autoTitle })} />
        </Section>

        <Section t={t} title="Appearance">
          <ChoiceRow
            t={t} title="Theme" value={settings.theme} onChange={(theme) => changeSettings({ theme })}
            options={[{ label: 'Auto', value: 'auto' as const }, { label: 'Light', value: 'light' as const }, { label: 'Dark', value: 'dark' as const }]}
          />
          <ChoiceRow
            t={t} title="Text" value={settings.textSize} onChange={(textSize) => changeSettings({ textSize })}
            options={[{ label: 'Small', value: 'small' as const }, { label: 'Medium', value: 'medium' as const }, { label: 'Large', value: 'large' as const }]}
          />
          <SwitchRow t={t} title="Haptics" value={settings.haptics} onChange={(haptics) => changeSettings({ haptics })} />
        </Section>

        <Section t={t} title="Data">
          <SwitchRow
            t={t} title="Ask on mobile data"
            value={settings.cellularWarning} onChange={(cellularWarning) => changeSettings({ cellularWarning })}
          />
          <Row t={t} title="Export chats" onPress={exportEverything} />
          <Row t={t} title="Delete chats" tone="danger" value={String(chatCount)} onPress={deleteAllChats} />
          <Row t={t} title="Delete memories" tone="danger" value={String(memories.length)} onPress={deleteAllMemories} />
        </Section>

        <Text style={[styles.about, { color: t.c.tertiary }]}>
          {[
            // The number in brackets is the build, as TestFlight shows it.
            `Version ${Constants.expoConfig?.version ?? ''}${Application.nativeBuildVersion ? ` (${Application.nativeBuildVersion})` : ''}`,
            `llama.cpp ${engineVersion}`,
            // Code delivered over the air since the build, by when it was made (UTC).
            Updates.isEmbeddedLaunch === false && Updates.createdAt
              ? `update ${Updates.createdAt.toISOString().slice(5, 16).replace('T', ' ')}` : '',
            ramMB ? `${Math.round(ramMB / 1024)} GB` : '',
            engine.status === 'ready' ? (engine.gpu ? 'GPU' : 'CPU') : '',
            engine.status === 'ready' ? `${(settings.nCtx / 1024).toFixed(settings.nCtx % 1024 ? 1 : 0)}K context` : '',
          ].filter(Boolean).join(' · ')}
        </Text>
        {!!lastClose && <Text style={[styles.about, styles.lastClose, { color: t.c.tertiary }]}>{lastClose}</Text>}
        {!!lastError && (
          <Text selectable numberOfLines={6} style={[styles.about, styles.lastClose, { color: t.c.tertiary }]}>
            Last error: {lastError}
          </Text>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 24, paddingBottom: 48 },
  about: { fontSize: 13, textAlign: 'center' },
  lastClose: { marginTop: -16, paddingHorizontal: 12 },
});
