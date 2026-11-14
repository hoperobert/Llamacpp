// The message box that floats over the bottom of a chat.

import React, { useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { app, changeSettings, haptic, submit } from '../lib/app';
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
  const engineStatus = app.use((s) => s.engine.status);
  const thinking = app.use((s) => s.settings.thinking);

  const ready = engineStatus === 'ready';
  const canSend = busy || (ready && !!draft.trim());
  const placeholder = ready ? 'Message' : engineStatus === 'loading' ? 'Getting the model ready…' : 'Choose a model to start';

  return (
    <View
      onLayout={(e) => onHeight(e.nativeEvent.layout.height)}
      style={[styles.wrap, { paddingBottom: keyboardOpen ? 8 : Math.max(insets.bottom, 10) }]}
      pointerEvents="box-none"
    >
      {!!status && <Text style={[styles.status, { color: t.c.secondary }]}>{status}</Text>}
      <Glass c={t.c} style={styles.box}>
        <Pressable
          onPress={() => { haptic('select'); changeSettings({ thinking: !thinking }); }}
          hitSlop={6}
          accessibilityRole="switch"
          accessibilityState={{ checked: thinking }}
          accessibilityLabel="Think before answering"
          style={[styles.round, thinking && { backgroundColor: t.c.accent }]}
        >
          <Icon
            name={thinking ? 'lightbulb.fill' : 'lightbulb'}
            size={18}
            color={thinking ? t.c.onAccent : t.c.secondary}
          />
        </Pressable>
        <TextInput
          value={draft}
          onChangeText={(text) => app.set({ draft: text })}
          multiline
          editable={ready || engineStatus === 'loading'}
          placeholder={placeholder}
          placeholderTextColor={t.c.tertiary}
          style={[styles.input, { color: t.c.text, fontSize: t.size }]}
        />
        <Pressable
          onPress={submit}
          disabled={!canSend}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={busy ? 'Stop' : 'Send'}
          style={[styles.round, { backgroundColor: canSend ? t.c.accent : t.c.dark ? '#3a3a3c' : '#d1d1d6' }]}
        >
          <Icon name={busy ? 'stop.fill' : 'arrow.up'} size={busy ? 14 : 17} color={t.c.onAccent} weight="bold" />
        </Pressable>
        {engineStatus === 'none' && (
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => router.push('/models')}
            accessibilityRole="button"
            accessibilityLabel="Choose a model"
          />
        )}
      </Glass>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingTop: 6 },
  status: { fontSize: 13, marginBottom: 8, marginLeft: 14 },
  box: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 6,
    borderRadius: 26, borderCurve: 'continuous', padding: 7,
  },
  round: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, maxHeight: 140, paddingTop: 8, paddingBottom: 8, paddingHorizontal: 4 },
});
