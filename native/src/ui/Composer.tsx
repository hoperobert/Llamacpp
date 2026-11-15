// The message box that floats over the bottom of a chat. The model in use is
// shown, and changed, from here.

import React, { useEffect, useState } from 'react';
import { Image, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hasNative } from '../../modules/pocket-native';
import { app, findModel, haptic, needsNoModel, runCommand, submit, talk } from '../lib/app';
import { parseCommand, suggest, type Command } from '../lib/commands';
import { imageUri } from '../lib/images';
import { STYLES } from '../lib/storage';
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

/** The text field, so the keyboard can be raised and lowered from elsewhere. */
export const composerInput = React.createRef<React.ComponentRef<typeof TextInput>>();

export function Composer({ t, onHeight }: { t: Theme; onHeight: (height: number) => void }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const keyboardOpen = useKeyboardOpen();
  const draft = app.use((s) => s.draft);
  const busy = app.use((s) => s.busy);
  const status = app.use((s) => s.status);
  const queued = app.use((s) => s.queued);
  const attachment = app.use((s) => s.attachment);
  const attachedFile = app.use((s) => s.attachedFile);
  const listening = app.use((s) => s.listening);
  const engine = app.use((s) => s.engine);
  const thinking = app.use((s) => s.settings.thinking);
  const styleId = app.use((s) => s.settings.style);
  const goal = app.use((s) => !!s.chat.goal);
  // What is switched on, shown quietly next to the model's name.
  const lookingUp = app.use((s) => s.settings.lookup && (s.libraryFiles.length > 0 || Object.values(s.library).some((l) => l.status === 'ready')));
  const emergency = app.use((s) => s.settings.emergency);
  const extras = [emergency ? 'Emergency' : '', goal ? 'Goal' : '', thinking && !emergency ? 'Think' : '', lookingUp ? 'Look up' : '', styleId !== 'normal' ? STYLES.find((s) => s.id === styleId)?.label : '']
    .filter(Boolean).join(' · ');

  const ready = engine.status === 'ready';
  const typed = !!draft.trim() || !!attachment || !!attachedFile;
  // A command that acts on the app can be sent with no model loaded.
  const command = parseCommand(draft);
  const acts = !!command && !command.command.prompt;
  const canSend = busy || (ready && typed) || acts || (!attachment && !attachedFile && needsNoModel(draft));
  const commands = suggest(draft);

  const choose = (chosen: Command) => {
    haptic('select');
    if (chosen.takes) {
      // Something goes after it: leave it in the box to be finished.
      app.set({ draft: `/${chosen.name} ` });
    } else {
      app.set({ draft: '' });
      runCommand(chosen, '');
    }
  };
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
      {commands.length > 0 && (
        <Glass c={t.c} style={styles.commands}>
          <ScrollView keyboardShouldPersistTaps="always" showsVerticalScrollIndicator={false}>
            {commands.map((item) => (
              <Pressable
                key={item.name}
                onPress={() => choose(item)}
                accessibilityRole="button"
                accessibilityLabel={`/${item.name}. ${item.hint}`}
                style={({ pressed }) => [styles.command, pressed && { backgroundColor: chip }]}
              >
                <Text style={[styles.commandName, { color: t.c.text }]}>/{item.name}</Text>
                <Text numberOfLines={1} style={[styles.commandHint, { color: t.c.secondary }]}>{item.hint}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </Glass>
      )}
      <Glass c={t.c} style={styles.box}>
        {!!attachment && (
          <View style={styles.photo}>
            <Image source={{ uri: imageUri(attachment) }} style={styles.photoImage} />
            <Pressable
              onPress={() => app.set({ attachment: null })}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Remove photo"
              style={[styles.photoRemove, { backgroundColor: t.c.text }]}
            >
              <Icon name="xmark" size={10} color={t.c.bg} weight="bold" />
            </Pressable>
          </View>
        )}
        {!!attachedFile && (
          <View style={[styles.file, { backgroundColor: chip }]}>
            <Icon name="doc.text" size={16} color={t.c.text} />
            <Text numberOfLines={1} style={[styles.fileName, { color: t.c.text }]}>{attachedFile.name}</Text>
            <Pressable
              onPress={() => app.set({ attachedFile: null })}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Remove file"
            >
              <Icon name="xmark.circle.fill" size={18} color={t.c.secondary} />
            </Pressable>
          </View>
        )}
        <TextInput
          ref={composerInput}
          value={draft}
          onChangeText={(text) => app.set({ draft: text })}
          multiline
          autoCapitalize={draft.startsWith('/') ? 'none' : 'sentences'}
          placeholder={
            busy ? 'Queue for after this reply…'
            : ready ? 'Ask anything' : engine.status === 'loading' ? 'Getting ready…' : 'Choose a model to start'
          }
          placeholderTextColor={t.c.tertiary}
          style={[styles.input, { color: t.c.text, fontSize: t.size }]}
        />
        <View style={styles.bar}>
          <Pressable
            onPress={() => { haptic(); router.push('/options'); }}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel="Reply options"
            style={({ pressed }) => [styles.round, { backgroundColor: chip }, pressed && styles.dim]}
          >
            <Icon name="plus" size={20} color={t.c.text} />
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
              {!!extras && ready && <Text style={{ color: t.c.secondary, fontWeight: '400' }}>  {extras}</Text>}
            </Text>
          </Pressable>
          <View style={styles.flex} />
          {(listening || (hasNative && !typed && !busy && !acts && ready)) ? (
            // With nothing typed, the button is for speaking: it listens, sends, and the reply is read aloud.
            <Pressable
              onPress={talk}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={listening ? 'Stop listening and send' : 'Speak'}
              style={({ pressed }) => [styles.round, { backgroundColor: listening ? t.c.accent : chip }, pressed && styles.dim]}
            >
              <Icon name={listening ? 'waveform' : 'mic'} size={19} color={listening ? t.c.onAccent : t.c.text} weight="semibold" />
            </Pressable>
          ) : (
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
          )}
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
  photo: { alignSelf: 'flex-start', marginLeft: 6, marginTop: 4, marginBottom: 4 },
  photoImage: { width: 64, height: 64, borderRadius: 14 },
  file: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '90%',
    marginLeft: 6, marginTop: 4, marginBottom: 4, paddingLeft: 12, paddingRight: 8, height: 36, borderRadius: 18,
  },
  fileName: { fontSize: 15, flexShrink: 1 },
  photoRemove: {
    position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  box: { borderRadius: 30, borderCurve: 'continuous', padding: 10 },
  // The list of commands, shown above the box while one is being typed.
  commands: { borderRadius: 24, borderCurve: 'continuous', paddingVertical: 6, marginBottom: 8, maxHeight: 264, overflow: 'hidden' },
  command: { flexDirection: 'row', alignItems: 'baseline', gap: 12, paddingHorizontal: 18, paddingVertical: 11 },
  commandName: { fontSize: 16, fontWeight: '600' },
  commandHint: { fontSize: 15, flexShrink: 1 },
  input: { maxHeight: 150, minHeight: 40, paddingTop: 8, paddingBottom: 8, paddingHorizontal: 8 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  round: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.5 },
  model: { height: 42, borderRadius: 21, paddingHorizontal: 16, justifyContent: 'center', flexShrink: 1 },
  modelText: { fontSize: 16, fontWeight: '600' },
});
