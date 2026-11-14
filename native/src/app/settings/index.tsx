import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import Constants from 'expo-constants';
import { Stack, useRouter } from 'expo-router';
import {
  app, changeSettings, deleteAllChats, deleteAllMemories, exportEverything, findModel,
} from '../../lib/app';
import { deviceName, ramMB } from '../../lib/device';
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
        </Section>

        <Section t={t} title="Personalisation" footer="Memories are facts about you that carry across chats.">
          <Row
            t={t} icon="text.bubble" title="Custom Instructions"
            value={settings.instructions.trim() ? 'On' : 'Off'}
            chevron onPress={() => router.push('/settings/instructions')}
          />
          <Row
            t={t} icon="brain" title="Memory"
            value={settings.memoryOn ? `${memories.length} saved` : 'Off'}
            chevron onPress={() => router.push('/settings/memory')}
          />
        </Section>

        <Section t={t} title="Replies">
          <ChoiceRow
            t={t} title="Creativity" value={settings.temperature}
            onChange={(temperature) => changeSettings({ temperature })}
            options={[{ label: 'Precise', value: 0.2 }, { label: 'Balanced', value: 0.7 }, { label: 'Creative', value: 1.1 }]}
          />
          <ChoiceRow
            t={t} title="Longest Reply" value={settings.maxTokens}
            onChange={(maxTokens) => changeSettings({ maxTokens })}
            options={[{ label: 'Short', value: 256 }, { label: 'Medium', value: 768 }, { label: 'Long', value: 1536 }, { label: 'Longest', value: 3072 }]}
          />
          <SwitchRow
            t={t} title="Think Before Answering" subtitle="Better on hard questions, slower."
            value={settings.thinking} onChange={(thinking) => changeSettings({ thinking })}
          />
        </Section>

        <Section
          t={t} title="Context"
          footer="How much of a chat the model can hold at once. Larger sizes use more memory. Changing this reloads the model."
        >
          <ChoiceRow
            t={t} title="Context Size" value={settings.nCtx}
            onChange={(nCtx) => changeSettings({ nCtx })}
            options={[{ label: 'Small', value: 2048 }, { label: 'Medium', value: 4096 }, { label: 'Large', value: 8192 }, { label: 'Huge', value: 16384 }]}
          />
          <SwitchRow
            t={t} title="Summarise Long Chats"
            subtitle="Keeps the gist when a chat outgrows the context. When off, old messages are dropped."
            value={settings.autoSummary} onChange={(autoSummary) => changeSettings({ autoSummary })}
          />
          <SwitchRow
            t={t} title="Name Chats Automatically"
            value={settings.autoTitle} onChange={(autoTitle) => changeSettings({ autoTitle })}
          />
        </Section>

        <Section t={t} title="Appearance">
          <ChoiceRow
            t={t} title="Theme" value={settings.theme} onChange={(theme) => changeSettings({ theme })}
            options={[{ label: 'Automatic', value: 'auto' as const }, { label: 'Light', value: 'light' as const }, { label: 'Dark', value: 'dark' as const }]}
          />
          <ChoiceRow
            t={t} title="Text Size" value={settings.textSize} onChange={(textSize) => changeSettings({ textSize })}
            options={[{ label: 'Small', value: 'small' as const }, { label: 'Medium', value: 'medium' as const }, { label: 'Large', value: 'large' as const }]}
          />
          <SwitchRow t={t} title="Haptics" value={settings.haptics} onChange={(haptics) => changeSettings({ haptics })} />
        </Section>

        <Section t={t} title="Downloads" footer="Downloads continue when you leave the app or lock your iPhone.">
          <SwitchRow
            t={t} title="Ask Before Using Mobile Data"
            value={settings.cellularWarning} onChange={(cellularWarning) => changeSettings({ cellularWarning })}
          />
        </Section>

        <Section t={t} title="Your Data" footer="Chats and memories are stored only on this iPhone.">
          <Row t={t} icon="square.and.arrow.up" title="Export All Chats" onPress={exportEverything} />
          <Row t={t} icon="trash" title="Delete All Chats" tone="danger" value={String(chatCount)} onPress={deleteAllChats} />
          <Row t={t} icon="trash" title="Delete All Memories" tone="danger" value={String(memories.length)} onPress={deleteAllMemories} />
        </Section>

        <Text style={[styles.about, { color: t.c.tertiary }]}>
          Pocket LLM {Constants.expoConfig?.version ?? ''} · llama.cpp {engineVersion}{'\n'}
          {deviceName}{ramMB ? ` · ${Math.round(ramMB / 1024)} GB memory` : ''}
          {engine.status === 'ready' ? ` · ${engine.gpu ? 'Running on the GPU' : 'Running on the CPU'}` : ''}
        </Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 26, paddingBottom: 48 },
  about: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
});
