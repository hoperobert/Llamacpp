// One message in a chat: the user's bubble, or the assistant's reply with its
// thinking, its actions and its speed.

import React, { useEffect, useState } from 'react';
import { ActionSheetIOS, Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { app, copyText, editLast, regenerate, shareText, speak } from '../lib/app';
import type { Message } from '../lib/storage';
import { Icon, type IconName } from './Icon';
import { Markdown } from './Markdown';
import type { Theme } from './theme';

type Props = {
  t: Theme;
  message: Message;
  /** True while this reply is still being written. */
  streaming?: boolean;
  /** The last question, which can be taken back and changed. */
  canEdit?: boolean;
  /** The last reply, which can be asked for again. */
  canRetry?: boolean;
  /** Shown above the message where older messages stop being sent to the model. */
  divider?: string;
};

/** The press-and-hold menu on one of the user's own messages. */
function menu(message: Message, canEdit?: boolean) {
  if (Platform.OS !== 'ios') return;
  const actions: { label: string; run: () => void }[] = [
    { label: 'Copy', run: () => copyText(message.content) },
    { label: 'Share…', run: () => shareText(message.content) },
  ];
  if (canEdit) actions.push({ label: 'Edit', run: editLast });
  ActionSheetIOS.showActionSheetWithOptions(
    { options: [...actions.map((a) => a.label), 'Cancel'], cancelButtonIndex: actions.length },
    (index) => actions[index]?.run(),
  );
}

export const MessageRow = React.memo(function MessageRow(p: Props) {
  const { t, message, streaming, divider } = p;
  const onLongPress = () => menu(message, p.canEdit);
  return (
    <View style={styles.wrap}>
      {!!divider && <Text style={[styles.divider, { color: t.c.tertiary }]}>{divider}</Text>}
      {message.role === 'user' ? (
        <Pressable onLongPress={onLongPress} delayLongPress={320} style={styles.userRow}>
          <View style={[styles.bubble, { backgroundColor: t.c.fill }]}>
            <Text style={{ color: t.c.text, fontSize: t.size, lineHeight: t.size * 1.4 }}>
              {message.content}
            </Text>
          </View>
        </Pressable>
      ) : (
        // No press-and-hold menu here: holding a reply selects its text instead.
        <View style={styles.assistant}>
          <Thinking t={t} message={message} streaming={!!streaming} />
          {streaming && !message.content
            ? (!message.reasoning && <Dots t={t} />)
            : <Markdown source={message.content} t={t} />}
          {!!message.stopped && !streaming && (
            <Text style={[styles.note, { color: t.c.secondary }]}>{message.stopped}</Text>
          )}
          {!streaming && !!message.content && <Actions {...p} />}
        </View>
      )}
    </View>
  );
});

function Actions({ t, message, canRetry }: Props) {
  const id = message.id ?? message.content.slice(0, 24);
  const speaking = app.use((s) => s.speakingId === id);
  return (
    <View style={styles.actions}>
      <Action t={t} icon="doc.on.doc" label="Copy" onPress={() => copyText(message.content)} />
      <Action
        t={t}
        icon={speaking ? 'stop.circle' : 'speaker.wave.2'}
        label={speaking ? 'Stop reading' : 'Read aloud'}
        onPress={() => speak(message)}
      />
      <Action t={t} icon="square.and.arrow.up" label="Share" onPress={() => shareText(message.content)} />
      {canRetry && <Action t={t} icon="arrow.clockwise" label="Try again" onPress={regenerate} />}
      {!!message.speed && (
        <Text style={[styles.speed, { color: t.c.tertiary }]}>{message.speed.toFixed(1)} tokens/s</Text>
      )}
    </View>
  );
}

function Action({ t, icon, label, onPress }: { t: Theme; icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.action, pressed && { backgroundColor: t.c.fill }]}
    >
      <Icon name={icon} size={17} color={t.c.secondary} />
    </Pressable>
  );
}

/** The model's reasoning: live while it thinks, folded away once it answers. */
function Thinking({ t, message, streaming }: { t: Theme; message: Message; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const reasoning = message.reasoning?.trim();
  if (!reasoning) return null;
  const thinkingNow = streaming && !message.content;
  const label = thinkingNow
    ? 'Thinking…'
    : message.thought ? `Thought for ${message.thought} second${message.thought === 1 ? '' : 's'}` : 'Thought it through';
  // While it thinks, show where the thought has got to rather than where it began.
  const shown = thinkingNow ? reasoning.slice(-260).replace(/^\S*\s/, '…') : reasoning;
  return (
    <View style={styles.thinking}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        disabled={thinkingNow}
        hitSlop={8}
        style={styles.thinkingHead}
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${open ? 'Hide' : 'Show'} reasoning`}
      >
        <Icon name="lightbulb" size={15} color={t.c.secondary} />
        <Text style={[styles.thinkingLabel, { color: t.c.secondary }]}>{label}</Text>
        {!thinkingNow && <Icon name={open ? 'chevron.up' : 'chevron.down'} size={11} color={t.c.tertiary} weight="semibold" />}
      </Pressable>
      {(open || thinkingNow) && (
        <Text
          selectable={!thinkingNow}
          style={[styles.thinkingText, { color: t.c.secondary, borderLeftColor: t.c.line, fontSize: t.size - 2, lineHeight: (t.size - 2) * 1.45 }]}
        >
          {shown}
        </Text>
      )}
    </View>
  );
}

/** Three dots that pulse while the model reads the conversation. */
function Dots({ t }: { t: Theme }) {
  const [phase] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(phase, { toValue: 3, duration: 1100, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [phase]);
  return (
    <View style={styles.dots} accessibilityLabel="Working">
      {[0, 1, 2].map((i) => (
        <Animated.View
          key={i}
          style={[
            styles.dot,
            { backgroundColor: t.c.secondary },
            { opacity: phase.interpolate({ inputRange: [i, i + 0.5, i + 1, 3], outputRange: [0.25, 1, 0.25, 0.25], extrapolate: 'clamp' }) },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingVertical: 9 },
  divider: { textAlign: 'center', fontSize: 12, marginBottom: 16 },
  userRow: { alignItems: 'flex-end' },
  bubble: {
    maxWidth: '84%', borderRadius: 22, borderCurve: 'continuous',
    paddingHorizontal: 15, paddingVertical: 10,
  },
  assistant: { gap: 10 },
  note: { fontSize: 13 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: -8, marginTop: -2 },
  action: { width: 36, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  speed: { fontSize: 12, marginLeft: 8, fontVariant: ['tabular-nums'] },
  thinking: { gap: 8 },
  thinkingHead: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  thinkingLabel: { fontSize: 14, fontWeight: '500' },
  thinkingText: { borderLeftWidth: 2, paddingLeft: 12 },
  dots: { flexDirection: 'row', gap: 5, paddingVertical: 8 },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
