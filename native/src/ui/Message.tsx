// One message in a chat: the user's bubble, or the assistant's reply with its
// thinking, its actions and its speed.

import React, { useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, Animated, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  answerInstead, app, approveAction, cancelAction, copyText, editMessage, regenerate, send, shareText, speak,
} from '../lib/app';
import { describeAction } from '../lib/assistant';
import { imageUri } from '../lib/images';
import type { Message } from '../lib/storage';
import { splitThinking } from '../lib/text';
import { Icon, type IconName } from './Icon';
import { Markdown } from './Markdown';
import type { Theme } from './theme';

type Props = {
  t: Theme;
  message: Message;
  /** True while this reply is still being written. */
  streaming?: boolean;
  /** One of the user's messages, which can be taken back and changed. */
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
  if (canEdit) actions.push({ label: 'Edit', run: () => editMessage(message.id) });
  ActionSheetIOS.showActionSheetWithOptions(
    { options: [...actions.map((a) => a.label), 'Cancel'], cancelButtonIndex: actions.length },
    (index) => actions[index]?.run(),
  );
}

export const MessageRow = React.memo(function MessageRow(p: Props) {
  const { t, streaming, divider } = p;
  // A reply saved before thinking markers were all recognised may still have its thinking in it.
  const message = useMemo(() => {
    if (p.message.role !== 'assistant' || !/<\/?think|channel\|?>/i.test(p.message.content)) return p.message;
    const said = splitThinking(p.message.content);
    return {
      ...p.message,
      content: said.content,
      reasoning: [p.message.reasoning, said.reasoning].filter(Boolean).join('\n\n') || undefined,
    };
  }, [p.message]);
  const onLongPress = () => menu(message, p.canEdit);
  return (
    <View style={styles.wrap}>
      {!!divider && <Text style={[styles.divider, { color: t.c.tertiary }]}>{divider}</Text>}
      {message.role === 'user' ? (
        <Pressable onLongPress={onLongPress} delayLongPress={320} style={styles.userRow}>
          {!!message.image && (
            <Image source={{ uri: imageUri(message.image) }} style={[styles.photo, { backgroundColor: t.c.fill }]} />
          )}
          {!!message.content && (
            <View style={[styles.bubble, { backgroundColor: t.c.fill }]}>
              <Text style={{ color: t.c.text, fontSize: t.size, lineHeight: t.size * 1.4 }}>
                {message.content}
              </Text>
            </View>
          )}
          {!!message.sources?.length && (
            <View style={styles.sources}>
              <Icon name="books.vertical" size={13} color={t.c.tertiary} />
              <Text numberOfLines={1} style={[styles.sourcesText, { color: t.c.tertiary }]}>
                {message.sources.join(' · ')}
              </Text>
            </View>
          )}
        </Pressable>
      ) : (
        message.action ? <ActionCard t={t} message={message} last={!!p.canRetry} /> :
        // No press-and-hold menu here: holding a reply selects its text instead.
        <View style={styles.assistant}>
          <Thinking t={t} message={message} streaming={!!streaming} />
          {streaming && !message.content
            ? (!message.reasoning && <Dots t={t} />)
            : <Markdown source={message.content} t={t} />}
          {!!message.stopped && !streaming && (
            <View style={styles.paused}>
              <Text style={[styles.note, { color: t.c.secondary }]}>{message.stopped}</Text>
              {p.canRetry && (
                <Pressable
                  onPress={() => send('Continue')}
                  hitSlop={8}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.continue, { backgroundColor: t.c.fill }, pressed && styles.dim]}
                >
                  <Text style={[styles.continueText, { color: t.c.text }]}>Continue</Text>
                </Pressable>
              )}
            </View>
          )}
          {!streaming && !!message.content && <Actions {...p} message={message} />}
        </View>
      )}
    </View>
  );
});

const ACTION_ICONS: Record<NonNullable<Message['action']>['what']['kind'], IconName> = {
  reminder: 'bell', timer: 'timer', event: 'calendar', message: 'message', email: 'envelope', call: 'phone', directions: 'map',
};

/**
 * An offer to do something on the phone. Nothing is done until it is approved,
 * and once it has been the card says what happened.
 */
function ActionCard({ t, message, last }: { t: Theme; message: Message; last: boolean }) {
  const offered = message.action!;
  const [working, setWorking] = useState(false);
  // Worded as of when it was offered or done: "Tomorrow" stays the day that was meant.
  const card = useMemo(() => describeAction(offered.what, offered.asked), [offered]);
  const open = offered.state === 'proposed' || offered.state === 'failed';
  const approve = async () => {
    setWorking(true);
    await approveAction(message.id);
    setWorking(false);
  };
  return (
    <View style={[styles.card, { backgroundColor: t.c.card, borderColor: t.c.line }]}>
      <View style={styles.cardTop}>
        <View style={[styles.cardIcon, { backgroundColor: t.c.fill }]}>
          <Icon name={ACTION_ICONS[offered.what.kind]} size={18} color={t.c.text} />
        </View>
        <View style={styles.flex}>
          <Text style={[styles.cardTitle, { color: t.c.text }]}>{card.title}</Text>
          <Text style={[styles.cardDetail, { color: t.c.secondary }]}>{card.detail}</Text>
        </View>
      </View>
      {!!offered.note && (
        <View style={styles.cardNote}>
          {offered.state === 'done' && <Icon name="checkmark.circle.fill" size={16} color={t.c.good} />}
          <Text
            style={[styles.cardDetail, styles.flex, {
              color: offered.state === 'done' ? t.c.good : offered.state === 'failed' ? t.c.danger : t.c.tertiary,
            }]}
          >
            {offered.note}
          </Text>
        </View>
      )}
      {open && (
        <View style={styles.cardButtons}>
          <Pressable
            onPress={approve}
            disabled={working}
            accessibilityRole="button"
            style={({ pressed }) => [styles.cardButton, { backgroundColor: t.c.accent }, (pressed || working) && styles.dim]}
          >
            <Text style={[styles.cardButtonText, { color: t.c.onAccent }]}>
              {working ? 'Working…' : offered.state === 'failed' ? 'Try again' : card.approve}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => cancelAction(message.id)}
            disabled={working}
            accessibilityRole="button"
            style={({ pressed }) => [styles.cardButton, { backgroundColor: t.c.fill }, pressed && styles.dim]}
          >
            <Text style={[styles.cardButtonText, { color: t.c.text }]}>Cancel</Text>
          </Pressable>
        </View>
      )}
      {open && last && !working && (
        <Pressable onPress={() => answerInstead(message.id)} hitSlop={8} accessibilityRole="button">
          <Text style={[styles.cardLink, { color: t.c.secondary }]}>Not what I meant. Just answer.</Text>
        </Pressable>
      )}
    </View>
  );
}

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
        <Text style={[styles.speed, { color: t.c.tertiary }]}>{message.speed.toFixed(0)} tok/s</Text>
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
      <Icon name={icon} size={19} color={t.c.secondary} />
    </Pressable>
  );
}

/**
 * The model's reasoning, kept out of the way: one line that says it is thinking,
 * or for how long it thought. Tapping the line shows the reasoning itself.
 */
function Thinking({ t, message, streaming }: { t: Theme; message: Message; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const reasoning = message.reasoning?.trim();
  if (!reasoning) return null;
  const thinkingNow = streaming && !message.content;
  const label = thinkingNow
    ? 'Thinking…'
    : message.thought ? `Thought for ${message.thought}s` : 'Thought';
  return (
    <View style={styles.thinking}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        hitSlop={10}
        style={({ pressed }) => [styles.thinkingHead, pressed && styles.dim]}
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${open ? 'Hide' : 'Show'} reasoning`}
      >
        {thinkingNow ? <Pulse t={t} /> : <Icon name="lightbulb" size={16} color={t.c.secondary} />}
        <Text style={[styles.thinkingLabel, { color: t.c.secondary }]}>{label}</Text>
        <Icon name={open ? 'chevron.down' : 'chevron.right'} size={12} color={t.c.tertiary} weight="semibold" />
      </Pressable>
      {open && (
        <Text
          selectable={!thinkingNow}
          style={[styles.thinkingText, { color: t.c.secondary, borderLeftColor: t.c.line, fontSize: t.size - 2, lineHeight: (t.size - 2) * 1.45 }]}
        >
          {reasoning}
        </Text>
      )}
    </View>
  );
}

/** A dot that breathes while the model is busy. */
function Pulse({ t }: { t: Theme }) {
  const [pulse] = useState(() => new Animated.Value(0.25));
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.25, duration: 600, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View style={[styles.dot, { backgroundColor: t.c.accent, opacity: pulse }]} />;
}

/** A pulsing dot and a word, shown while the model reads the conversation. */
function Dots({ t }: { t: Theme }) {
  return (
    <View style={styles.dots}>
      <Pulse t={t} />
      <Text style={[styles.working, { color: t.c.secondary }]}>Working…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingVertical: 9 },
  divider: { textAlign: 'center', fontSize: 12, marginBottom: 16 },
  userRow: { alignItems: 'flex-end', gap: 6 },
  sources: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '84%' },
  sourcesText: { fontSize: 12, flexShrink: 1 },
  photo: { width: 220, height: 220, borderRadius: 20, borderCurve: 'continuous' },
  bubble: {
    maxWidth: '84%', borderRadius: 24, borderCurve: 'continuous',
    paddingHorizontal: 17, paddingVertical: 11,
  },
  assistant: { gap: 10 },
  flex: { flex: 1 },
  card: { borderRadius: 22, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  cardDetail: { fontSize: 14, marginTop: 2 },
  cardNote: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardButtons: { flexDirection: 'row', gap: 10 },
  cardButton: { flex: 1, height: 42, borderRadius: 21, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  cardButtonText: { fontSize: 15, fontWeight: '600' },
  cardLink: { fontSize: 13, textAlign: 'center' },
  note: { fontSize: 13 },
  paused: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  continue: { borderRadius: 100, paddingHorizontal: 14, paddingVertical: 7 },
  continueText: { fontSize: 14, fontWeight: '600' },
  dim: { opacity: 0.5 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: -8, marginTop: -2 },
  action: { width: 40, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  speed: { fontSize: 12, marginLeft: 8, fontVariant: ['tabular-nums'] },
  thinking: { gap: 8 },
  thinkingHead: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' },
  thinkingLabel: { fontSize: 16 },
  thinkingText: { borderLeftWidth: 2, paddingLeft: 12 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  working: { fontSize: 16 },
});
