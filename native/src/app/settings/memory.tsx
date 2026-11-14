import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { app, changeSettings, forget, haptic, remember } from '../../lib/app';
import { Icon } from '../../ui/Icon';
import { Section, SwitchRow } from '../../ui/List';
import { useTheme } from '../../ui/theme';

export default function MemoryScreen() {
  const t = useTheme();
  const settings = app.use((s) => s.settings);
  const memories = app.use((s) => s.memories);
  const [draft, setDraft] = useState('');

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    if (remember(text)) haptic('success');
    setDraft('');
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.body}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      <Section
        t={t}
        footer="You can also type /remember followed by a fact in any chat."
      >
        <SwitchRow
          t={t} title="Use Memories" subtitle="Share saved facts with every chat."
          value={settings.memoryOn} onChange={(memoryOn) => changeSettings({ memoryOn })}
        />
        <SwitchRow
          t={t} title="Save Automatically" subtitle="Picks up facts you mention about yourself."
          value={settings.autoMemory} onChange={(autoMemory) => changeSettings({ autoMemory })}
        />
      </Section>

      <Section t={t} title="Add a Memory">
        <View style={styles.addRow}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="For example: I'm vegetarian"
            placeholderTextColor={t.c.tertiary}
            returnKeyType="done"
            onSubmitEditing={add}
            style={[styles.input, { color: t.c.text }]}
          />
          <Pressable
            onPress={add}
            disabled={!draft.trim()}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Add memory"
            style={[styles.add, { backgroundColor: draft.trim() ? t.c.accent : t.c.fill }]}
          >
            <Icon name="plus" size={15} color={draft.trim() ? t.c.onAccent : t.c.tertiary} weight="bold" />
          </Pressable>
        </View>
      </Section>

      {memories.length > 0 ? (
        <Section t={t} title="Saved">
          {memories.map((m) => (
            <View key={m.id} style={styles.memory}>
              <Text style={[styles.memoryText, { color: t.c.text }]}>{m.text}</Text>
              <Pressable onPress={() => { haptic(); forget(m.id); }} hitSlop={12} accessibilityLabel={`Delete memory: ${m.text}`}>
                <Icon name="xmark.circle.fill" size={20} color={t.c.tertiary} />
              </Pressable>
            </View>
          ))}
        </Section>
      ) : (
        <Text style={[styles.empty, { color: t.c.secondary }]}>Nothing saved yet.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 26, paddingBottom: 48 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 16, paddingRight: 10, minHeight: 50 },
  input: { flex: 1, fontSize: 17, paddingVertical: 12 },
  add: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  memory: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 50 },
  memoryText: { flex: 1, fontSize: 17, lineHeight: 22 },
  empty: { fontSize: 15, textAlign: 'center' },
});
