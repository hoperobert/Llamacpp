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
  const engine = app.use((s) => s.engine);
  const thinking = app.use((s) => s.settings.thinking);

  const ready = engine.status === 'ready';
  const canSend = busy || (ready && !!draft.trim());
  const model = findModel(engine.modelId);
  const modelLabel = engine.status === 'loading'
    ? `Loading ${Math.round(engine.fraction * 100)}%`
    : ready && model ? model.name : 'Choose model';

  return (
    <View
      onLayout={(e) => onHeight(e.nativeEvent.layout.height)}
      style={[styles.wrap, { paddingBottom: keyboardOpen ? 8 : Math.max(insets.bottom, 10) }]}
      pointerEvents="box-none"
    >
      {!!status && <Text style={[styles.status, { color: t.c.secondary }]}>{status}</Text>}
      <Glass c={t.c} style={styles.box}>
        <TextInput
          value={draft}
          onChangeText={(text) => app.set({ draft: text })}
          multiline
          editable={engine.status !== 'none'}
          placeholder={ready ? 'Ask anything' : engine.status === 'loading' ? 'Getting ready…' : 'Choose a model to start'}
          placeholderTextColor={t.c.tertiary}
          style={[styles.input, { color: t.c.text, fontSize: t.size }]}
        />
        <View style={styles.bar}>
          <Pressable
            onPress={() => { haptic('select'); changeSettings({ thinking: !thinking }); }}
            hitSlop={6}
            accessibilityRole="switch"
            accessibilityState={{ checked: thinking }}
            accessibilityLabel="Think before answering"
            style={[
              styles.round,
              { borderColor: thinking ? t.c.accent : t.c.line, backgroundColor: thinking ? t.c.accent : 'transparent' },
            ]}
          >
            <Icon name={thinking ? 'lightbulb.fill' : 'lightbulb'} size={17} color={thinking ? t.c.onAccent : t.c.secondary} />
          </Pressable>
          <View style={styles.flex} />
          <Pressable
            onPress={() => router.push('/models')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`${modelLabel}. Change model`}
            style={({ pressed }) => [styles.model, pressed && styles.dim]}
          >
            <Text numberOfLines={1} style={[styles.modelText, { color: t.c.secondary }]}>{modelLabel}</Text>
            <Icon name="chevron.down" size={10} color={t.c.tertiary} weight="bold" />
          </Pressable>
          <Pressable
            onPress={submit}
            disabled={!canSend}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={busy ? 'Stop' : 'Send'}
            style={[styles.round, styles.send, { backgroundColor: t.c.accent }, !canSend && styles.off]}
          >
            <Icon name={busy ? 'stop.fill' : 'arrow.up'} size={busy ? 13 : 16} color={t.c.onAccent} weight="bold" />
          </Pressable>
        </View>
      </Glass>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingTop: 6 },
  status: { fontSize: 13, marginBottom: 8, marginLeft: 14 },
  box: { borderRadius: 26, borderCurve: 'continuous', paddingHorizontal: 10, paddingTop: 8, paddingBottom: 8 },
  input: { maxHeight: 140, minHeight: 36, paddingTop: 6, paddingBottom: 6, paddingHorizontal: 6 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  round: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  send: { borderWidth: 0 },
  off: { opacity: 0.35 },
  dim: { opacity: 0.5 },
  model: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 190, paddingVertical: 6 },
  modelText: { fontSize: 14, fontWeight: '500', flexShrink: 1 },
});
