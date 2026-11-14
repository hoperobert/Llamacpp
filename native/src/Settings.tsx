import React from 'react';
import {
  Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { engineVersion } from './engine';
import type { Memory, Settings as SettingsData } from './storage';
import type { Palette } from './theme';

type Props = {
  visible: boolean;
  c: Palette;
  settings: SettingsData;
  memories: Memory[];
  models: React.ReactNode;
  onChange: (patch: Partial<SettingsData>) => void;
  onAddMemory: (text: string) => void;
  onRemoveMemory: (id: string) => void;
  onDeleteChats: () => void;
  onDeleteMemories: () => void;
  onClose: () => void;
};

// These are defined at the top level on purpose: components declared inside
// another component are recreated on every render, which would make text
// fields inside them lose focus while typing.

function Section({ c, title, children }: { c: Palette; title: string; children: React.ReactNode }) {
  return (
    <View style={[styles.section, { backgroundColor: c.bg, borderColor: c.line }]}>
      <Text style={[styles.heading, { color: c.muted }]}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}

function Toggle({ c, label, hint, value, onValue }: {
  c: Palette; label: string; hint: string; value: boolean; onValue: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggle}>
      <View style={styles.flex}>
        <Text style={[styles.label, { color: c.text }]}>{label}</Text>
        <Text style={[styles.hint, { color: c.muted }]}>{hint}</Text>
      </View>
      <Switch value={value} onValueChange={onValue} />
    </View>
  );
}

function Choice<T extends string | number>({ c, label, value, options, onValue }: {
  c: Palette; label: string; value: T; options: { label: string; value: T }[]; onValue: (v: T) => void;
}) {
  return (
    <View style={styles.choice}>
      <Text style={[styles.label, { color: c.text }]}>{label}</Text>
      <View style={[styles.segments, { backgroundColor: c.sunken }]}>
        {options.map((o) => (
          <Pressable
            key={String(o.value)}
            onPress={() => onValue(o.value)}
            style={[styles.segment, value === o.value && { backgroundColor: c.accent }]}
          >
            <Text style={[styles.segmentText, { color: value === o.value ? c.accentText : c.text }]}>
              {o.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function Settings(p: Props) {
  const { c, settings } = p;
  const [draft, setDraft] = React.useState('');

  return (
    <Modal visible={p.visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={p.onClose}>
      <SafeAreaView style={[styles.flex, { backgroundColor: c.sunken }]} edges={['bottom']}>
        <View style={[styles.head, { backgroundColor: c.bg, borderBottomColor: c.line }]}>
          <Text style={[styles.title, { color: c.text }]}>Settings</Text>
          <Pressable onPress={p.onClose} hitSlop={10}>
            <Text style={[styles.done, { color: c.text }]}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Section c={c} title="Model">{p.models}</Section>

          <Section c={c} title="Custom instructions">
            <TextInput
              multiline
              defaultValue={settings.instructions}
              onEndEditing={(e) => p.onChange({ instructions: e.nativeEvent.text })}
              placeholder="How should it respond? For example: Be brief. Use British English."
              placeholderTextColor={c.muted}
              style={[styles.input, styles.multiline, { color: c.text, backgroundColor: c.surface, borderColor: c.line }]}
            />
          </Section>

          <Section c={c} title="Memory">
            <Toggle
              c={c}
              label="Use memories" hint="Share saved facts with every chat."
              value={settings.memoryOn} onValue={(v) => p.onChange({ memoryOn: v })}
            />
            <Toggle
              c={c}
              label="Save memories automatically" hint="Picks up facts you mention about yourself."
              value={settings.autoMemory} onValue={(v) => p.onChange({ autoMemory: v })}
            />
            {p.memories.length === 0 && (
              <Text style={[styles.hint, { color: c.muted }]}>Nothing saved yet.</Text>
            )}
            {p.memories.map((m) => (
              <View key={m.id} style={[styles.memory, { backgroundColor: c.surface, borderColor: c.line }]}>
                <Text style={[styles.flex, { color: c.text }]}>{m.text}</Text>
                <Pressable onPress={() => p.onRemoveMemory(m.id)} hitSlop={10} accessibilityLabel="Delete memory">
                  <Text style={[styles.remove, { color: c.muted }]}>✕</Text>
                </Pressable>
              </View>
            ))}
            <View style={styles.addRow}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Add a memory, e.g. I'm vegetarian"
                placeholderTextColor={c.muted}
                returnKeyType="done"
                onSubmitEditing={() => { p.onAddMemory(draft); setDraft(''); }}
                style={[styles.input, styles.flex, { color: c.text, backgroundColor: c.surface, borderColor: c.line }]}
              />
              <Pressable onPress={() => { p.onAddMemory(draft); setDraft(''); }} hitSlop={8}>
                <Text style={[styles.done, { color: c.text }]}>Add</Text>
              </Pressable>
            </View>
          </Section>

          <Section c={c} title="Replies">
            <Choice
              c={c}
              label="Creativity" value={settings.temperature} onValue={(v) => p.onChange({ temperature: v })}
              options={[{ label: 'Precise', value: 0.2 }, { label: 'Balanced', value: 0.7 }, { label: 'Creative', value: 1.1 }]}
            />
            <Choice
              c={c}
              label="Longest reply" value={settings.maxTokens} onValue={(v) => p.onChange({ maxTokens: v })}
              options={[{ label: 'Short', value: 256 }, { label: 'Medium', value: 768 }, { label: 'Long', value: 1536 }]}
            />
            <Toggle
              c={c}
              label="Think before answering" hint="Better on hard questions, slower."
              value={settings.thinking} onValue={(v) => p.onChange({ thinking: v })}
            />
          </Section>

          <Section c={c} title="Context">
            <Choice
              c={c}
              label="Context size (reloads the model)" value={settings.nCtx} onValue={(v) => p.onChange({ nCtx: v })}
              options={[{ label: 'Small', value: 2048 }, { label: 'Medium', value: 4096 }, { label: 'Large', value: 8192 }]}
            />
            <Toggle
              c={c}
              label="Summarise long chats"
              hint="Keeps the gist when a chat outgrows the context. Off: old messages are dropped."
              value={settings.autoSummary} onValue={(v) => p.onChange({ autoSummary: v })}
            />
          </Section>

          <Section c={c} title="Appearance">
            <Choice
              c={c}
              label="Theme" value={settings.theme} onValue={(v) => p.onChange({ theme: v })}
              options={[{ label: 'Auto', value: 'auto' as const }, { label: 'Light', value: 'light' as const }, { label: 'Dark', value: 'dark' as const }]}
            />
          </Section>

          <Section c={c} title="Data">
            <Pressable onPress={p.onDeleteChats} style={styles.rowButton}>
              <Text style={[styles.label, { color: c.danger }]}>Delete all chats</Text>
            </Pressable>
            <Pressable onPress={p.onDeleteMemories} style={[styles.rowButton, { borderTopColor: c.line, borderTopWidth: 1 }]}>
              <Text style={[styles.label, { color: c.danger }]}>Delete all memories</Text>
            </Pressable>
          </Section>

          <Text style={[styles.about, { color: c.muted }]}>Engine: llama.cpp {engineVersion}, through llama.rn.</Text>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1,
  },
  title: { fontSize: 17, fontWeight: '700' },
  done: { fontSize: 16, fontWeight: '600', paddingHorizontal: 4 },
  body: { padding: 16, gap: 16, paddingBottom: 40 },
  section: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 },
  heading: { fontSize: 12, fontWeight: '600', letterSpacing: 0.6 },
  label: { fontSize: 16 },
  hint: { fontSize: 13, lineHeight: 18 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  choice: { gap: 8 },
  segments: { flexDirection: 'row', borderRadius: 10, padding: 3 },
  segment: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segmentText: { fontSize: 14, fontWeight: '500' },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  multiline: { minHeight: 84, textAlignVertical: 'top' },
  memory: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, padding: 12 },
  remove: { fontSize: 15 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowButton: { paddingVertical: 10 },
  about: { fontSize: 13, textAlign: 'center' },
});
