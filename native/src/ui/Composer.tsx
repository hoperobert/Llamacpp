// The message box that floats over the bottom of a chat. The model in use is
// shown, and changed, from here.

import React, { useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { app, changeSettings, findModel, haptic, submit } from '../lib/app';
import { Glass } from './Glass';
import { Icon } from './Icon';
import type { Theme } from './theme';

function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setOpen(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setOpen(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return open;
}

export function Composer({ t, onHeight }: { t: Theme; onHeight: (height: number) => void }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const keyboardOpen = useKeyboardOpen();
  const draft = app.use((s) => s.draft);
  const busy = app.use((s) => s.busy);
  const status = app.use((s) => s.status);
  const queued = app.use((s) => s.queued);
  const engine = app.use((s) => s.engine);
  const thinking = app.use((s) => s.settings.thinking);

  const ready = engine.status === 'ready';
  const typed = !!draft.trim();
  const canSend = busy || (ready && typed);
  // While a reply is being written the button stops it, unless there is something to queue.
  const stops = busy && !typed;
  const model = findModel(engine.modelId);
  const modelLabel = engine.status === 'loading'
    ? `Loading ${Math.round(engine.fraction * 100)}%`
    : ready && model ? model.name : 'Choose model';
  // Buttons sit on the glass, so they are a faint tint rather than more glass.
  const chip = t.c.dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.055)';

  return (
    <View
      onLayout={(e) => onHeight(e.nativeEvent.layout.height)}
      style={[styles.wrap, { paddingBottom: keyboardOpen ? 8 : Math.max(insets.bottom, 10) }]}
      pointerEvents="box-none"
    >
      {!!status && <Text style={[styles.status, { color: t.c.secondary }]}>{status}</Text>}
      {!!queued && (
        <Pressable
          onPress={() => app.set({ queued: '', draft: queued })}
          accessibilityRole="button"
          accessibilityLabel="Queued message. Tap to edit"
          style={styles.queued}
        >
          <Text numberOfLines={1} style={[styles.queuedText, { color: t.c.secondary }]}>Next: {queued}</Text>
        </Pressable>
      )}
      <Glass c={t.c} style={styles.box}>
        <TextInput
          value={draft}
          onChangeText={(text) => app.set({ draft: text })}
          multiline
          editable={engine.status !== 'none'}
          placeholder={
            busy ? 'Queue for after this reply…'
            : ready ? 'Ask anything' : engine.status === 'loading' ? 'Getting ready…' : 'Choose a model to start'
          }
          placeholderTextColor={t.c.tertiary}
          style={[styles.input, { color: t.c.text, fontSize: t.size }]}
        />
        <View style={styles.bar}>
          <Pressable
            onPress={() => { haptic('select'); changeSettings({ thinking: !thinking }); }}
            hitSlop={4}
            accessibilityRole="switch"
            accessibilityState={{ checked: thinking }}
            accessibilityLabel="Think before answering"
            style={({ pressed }) => [
              styles.round, { backgroundColor: thinking ? t.c.accent : chip }, pressed && styles.dim,
            ]}
          >
            <Icon
              name={thinking ? 'lightbulb.fill' : 'lightbulb'}
              size={19}
              color={thinking ? t.c.onAccent : t.c.text}
            />
          </Pressable>
          <Pressable
            onPress={() => router.push('/models')}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={`${modelLabel}. Change model`}
            style={({ pressed }) => [styles.model, { backgroundColor: chip }, pressed && styles.dim]}
          >
            <Text numberOfLines={1} style={[styles.modelText, { color: t.c.text }]}>
              {modelLabel}
              {thinking && ready && <Text style={{ color: t.c.secondary, fontWeight: '400' }}>  Think</Text>}
            </Text>
          </Pressable>
          <View style={styles.flex} />
          <Pressable
            onPress={submit}
            disabled={!canSend}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={stops ? 'Stop' : busy ? 'Queue' : 'Send'}
            // Sending is the one filled button. Stopping is quiet, like the other controls.
            style={[styles.round, { backgroundColor: canSend && !stops ? t.c.accent : chip }]}
          >
            <Icon
              name={stops ? 'stop.fill' : 'arrow.up'}
              size={stops ? 15 : 19}
              color={stops ? t.c.text : canSend ? t.c.onAccent : t.c.tertiary}
              weight="semibold"
            />
          </Pressable>
        </View>
      </Glass>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 10, paddingTop: 6 },
  status: { fontSize: 13, marginBottom: 8, marginLeft: 16 },
  queued: { marginBottom: 8, marginHorizontal: 16 },
  queuedText: { fontSize: 14 },
  box: { borderRadius: 30, borderCurve: 'continuous', padding: 10 },
  input: { maxHeight: 150, minHeight: 40, paddingTop: 8, paddingBottom: 8, paddingHorizontal: 8 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  round: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.5 },
  model: { height: 42, borderRadius: 21, paddingHorizontal: 16, justifyContent: 'center', flexShrink: 1 },
  modelText: { fontSize: 16, fontWeight: '600' },
});
