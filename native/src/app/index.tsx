// The chat.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import {
  app, changeSettings, contextUse, findModel, newChat, removeChat, renameChat, send, shareChat,
  summariseNow, togglePin,
} from '../lib/app';
import { ramMB } from '../lib/device';
import { recommended } from '../lib/models';
import type { Message } from '../lib/storage';
import { Composer } from '../ui/Composer';
import { Glass } from '../ui/Glass';
import { Icon, type IconName } from '../ui/Icon';
import { MessageRow } from '../ui/Message';
import { ModelRow } from '../ui/ModelRow';
import { Toast } from '../ui/Toast';
import { useTheme, type Theme } from '../ui/theme';

const SUGGESTIONS: { icon: IconName; title: string; prompt: string }[] = [
  { icon: 'graduationcap', title: 'Explain something', prompt: 'Explain how vaccines work in simple terms' },
  { icon: 'envelope', title: 'Write a message', prompt: 'Write a friendly text to reschedule dinner' },
  { icon: 'list.bullet.clipboard', title: 'Make a plan', prompt: 'Give me a 3-day plan to learn the basics of chess' },
  { icon: 'fork.knife', title: 'Plan a meal', prompt: 'Suggest a quick dinner I can make with eggs, rice and spinach' },
];

export default function ChatScreen() {
  const t = useTheme();
  const headerHeight = useHeaderHeight();
  const [composerHeight, setComposerHeight] = useState(72);
  const [scrolledUp, setScrolledUp] = useState(false);
  const list = useRef<FlatList<Row>>(null);

  const hydrated = app.use((s) => s.hydrated);
  const chat = app.use((s) => s.chat);
  const live = app.use((s) => s.live);
  const busy = app.use((s) => s.busy);
  const ready = app.use((s) => s.engine.status === 'ready');

  const rows = useMemo(() => buildRows(chat.messages, live, chat.cut, !!chat.summary, busy, ready), [
    chat.messages, live, chat.cut, chat.summary, busy, ready,
  ]);

  const renderItem = useCallback(({ item }: { item: Row }) => (
    <MessageRow
      t={t}
      message={item.message}
      streaming={item.streaming}
      canEdit={item.canEdit}
      canRetry={item.canRetry}
      divider={item.divider}
    />
  ), [t]);

  const empty = rows.length === 0;

  return (
    <View style={[styles.flex, { backgroundColor: t.c.bg }]}>
      <Header />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {/* The floating pieces sit inside this view so they rise with the keyboard. */}
        <View style={styles.flex}>
        {!hydrated ? null : empty ? (
          <ScrollView
            contentContainerStyle={[styles.emptyBody, { paddingTop: headerHeight + 24, paddingBottom: composerHeight + 16 }]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
          >
            {ready ? <Greeting t={t} /> : <Welcome t={t} />}
          </ScrollView>
        ) : (
          <FlatList
            ref={list}
            data={rows}
            inverted
            keyExtractor={(row) => row.key}
            renderItem={renderItem}
            // Inverted, so "top" padding is the space above the message box.
            contentContainerStyle={{ paddingTop: composerHeight + 6, paddingBottom: headerHeight + 8 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            onScroll={(e) => setScrolledUp(e.nativeEvent.contentOffset.y > 240)}
            scrollEventThrottle={64}
            initialNumToRender={12}
            maxToRenderPerBatch={8}
            windowSize={9}
          />
        )}

        {scrolledUp && !empty && (
          <Pressable
            onPress={() => list.current?.scrollToOffset({ offset: 0, animated: true })}
            accessibilityRole="button"
            accessibilityLabel="Scroll to the latest message"
            style={[styles.jump, { bottom: composerHeight + 8 }]}
          >
            <Glass c={t.c} interactive style={styles.jumpGlass}>
              <Icon name="arrow.down" size={16} color={t.c.text} weight="semibold" />
            </Glass>
          </Pressable>
        )}
        <TopFade t={t} height={headerHeight} />
        <Toast bottom={composerHeight + 10} />
        <Composer t={t} onHeight={setComposerHeight} />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

type Row = {
  key: string;
  message: Message;
  streaming?: boolean;
  canEdit?: boolean;
  canRetry?: boolean;
  divider?: string;
};

/** The messages, newest first, with what each one is allowed to do. */
function buildRows(
  messages: Message[], live: Message | null, cut: number, summarised: boolean, busy: boolean, ready: boolean,
): Row[] {
  const lastUser = messages.map((m) => m.role).lastIndexOf('user');
  const rows: Row[] = messages.map((message, i) => ({
    key: message.id ?? `m${i}`,
    message,
    canEdit: !busy && i === lastUser,
    canRetry: !busy && ready && i === messages.length - 1 && message.role === 'assistant',
    divider: cut > 0 && i === cut
      ? summarised ? 'Earlier messages were summarised' : 'Earlier messages are out of context'
      : undefined,
  }));
  // For an instant after a reply finishes it is both saved and still "live". Show it once.
  if (live && !messages.some((m) => m.id && m.id === live.id)) {
    rows.push({ key: live.id ?? 'live', message: live, streaming: true });
  }
  return rows.reverse();
}

// ---------- header ----------

const FADE_STEPS = [0.94, 0.86, 0.72, 0.54, 0.34, 0.16];

/**
 * A soft backdrop behind the header, so messages scrolling under it never
 * collide with the title. It is solid at the top and fades out below.
 */
function TopFade({ t, height }: { t: Theme; height: number }) {
  return (
    <View pointerEvents="none" style={styles.fade}>
      <View style={{ height: Math.max(0, height - 6), backgroundColor: t.c.bg, opacity: 0.94 }} />
      {FADE_STEPS.map((opacity) => (
        <View key={opacity} style={{ height: 4, backgroundColor: t.c.bg, opacity }} />
      ))}
    </View>
  );
}

function Header() {
  const t = useTheme();
  const router = useRouter();
  const chat = app.use((s) => s.chat);
  const settings = app.use((s) => s.settings);
  const memories = app.use((s) => s.memories);
  const busy = app.use((s) => s.busy);
  const ready = app.use((s) => s.engine.status === 'ready');
  const hasMessages = chat.messages.length > 0;
  const used = contextUse(chat, settings, memories);
  const percent = Math.min(100, Math.round((used / settings.nCtx) * 100));

  const showContext = () => {
    const canCompact = ready && !busy && chat.messages.length - chat.cut > 2;
    Alert.alert(
      `Context ${percent}% full`,
      `About ${used.toLocaleString()} of ${settings.nCtx.toLocaleString()} tokens used.\n\n` +
        'A model can only hold this much of a chat at once. When it fills up, older messages are ' +
        (settings.autoSummary ? 'summarised.' : 'dropped.'),
      [
        ...(canCompact
          ? [{ text: settings.autoSummary ? 'Summarise Now' : 'Drop Old Messages', onPress: summariseNow }]
          : []),
        { text: 'Close', style: 'cancel' as const },
      ],
    );
  };

  const rename = () => {
    if (Platform.OS !== 'ios') return;
    Alert.prompt('Rename Chat', undefined, (title) => renameChat(chat.id, title), 'plain-text', chat.title);
  };

  return (
    <>
      <Stack.Screen options={{ headerTitle: () => <ModelTitle t={t} /> }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button
          icon="line.3.horizontal"
          accessibilityLabel="Chats"
          onPress={() => router.push('/chats')}
        />
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="More">
          <Stack.Toolbar.MenuAction
            icon="lightbulb"
            isOn={settings.thinking}
            subtitle="Slower, better on hard questions"
            onPress={() => changeSettings({ thinking: !settings.thinking })}
          >
            Think Before Answering
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="gauge.with.dots.needle.33percent" hidden={!hasMessages} onPress={showContext}>
            {`Context ${percent}% Full`}
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.Menu inline>
            <Stack.Toolbar.MenuAction icon="square.and.arrow.up" hidden={!hasMessages} onPress={() => shareChat(chat.id)}>
              Share Chat
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction icon="pencil" hidden={!hasMessages} onPress={rename}>
              Rename
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction
              icon={chat.pinned ? 'pin.slash' : 'pin'}
              hidden={!hasMessages}
              onPress={() => togglePin(chat)}
            >
              {chat.pinned ? 'Unpin' : 'Pin'}
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction icon="trash" destructive hidden={!hasMessages} onPress={() => removeChat(chat)}>
              Delete Chat
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
          <Stack.Toolbar.MenuAction icon="gearshape" onPress={() => router.push('/settings')}>
            Settings
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.Button
          icon="square.and.pencil"
          accessibilityLabel="New chat"
          disabled={!hasMessages}
          onPress={newChat}
        />
      </Stack.Toolbar>
    </>
  );
}

/** The model's name in the middle of the header. Tapping it opens the model list. */
function ModelTitle({ t }: { t: Theme }) {
  const router = useRouter();
  const state = app.use((s) => s.engine);
  const model = findModel(state.modelId);
  const label = state.status === 'loading'
    ? `Loading ${Math.round(state.fraction * 100)}%`
    : state.status === 'ready' && model ? model.name : 'Choose a Model';
  return (
    <Pressable
      onPress={() => router.push('/models')}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`${label}. Change model`}
      style={({ pressed }) => [styles.title, pressed && styles.dim]}
    >
      <Text numberOfLines={1} style={[styles.titleText, { color: t.c.text }]}>{label}</Text>
      <Icon name="chevron.down" size={11} color={t.c.secondary} weight="bold" />
    </Pressable>
  );
}

// ---------- empty states ----------

function Greeting({ t }: { t: Theme }) {
  const busy = app.use((s) => s.busy);
  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Up late?' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return (
    <View style={styles.greeting}>
      <Text style={[styles.h1, { color: t.c.text }]}>{greeting}</Text>
      <Text style={[styles.lead, { color: t.c.secondary }]}>What would you like to do?</Text>
      <View style={styles.cards}>
        {SUGGESTIONS.map((s) => (
          <Pressable
            key={s.title}
            onPress={() => { if (!busy) send(s.prompt); }}
            accessibilityRole="button"
            style={({ pressed }) => [styles.card, { backgroundColor: t.c.fill }, pressed && styles.dim]}
          >
            <Icon name={s.icon} size={20} color={t.c.text} />
            <Text style={[styles.cardTitle, { color: t.c.text }]}>{s.title}</Text>
            <Text numberOfLines={2} style={[styles.cardBody, { color: t.c.secondary }]}>{s.prompt}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const POINTS: { icon: IconName; title: string; body: string }[] = [
  { icon: 'lock.fill', title: 'Private', body: 'Runs on this iPhone. Nothing you type leaves it.' },
  { icon: 'wifi.slash', title: 'Works offline', body: 'Once a model is downloaded, no connection is needed.' },
  { icon: 'bolt.fill', title: 'Yours to tune', body: 'Pick the model, how it answers and what it remembers.' },
];

function Welcome({ t }: { t: Theme }) {
  const router = useRouter();
  const crashed = app.use((s) => s.crashed);
  const settings = app.use((s) => s.settings);
  const downloaded = app.use((s) => s.downloaded);
  // Offer the model used last time if it is still here, otherwise a good first pick.
  const last = findModel(settings.modelId);
  const pick = last && downloaded[last.id] ? last : recommended(ramMB);
  return (
    <View style={styles.welcome}>
      <Text style={[styles.h1, { color: t.c.text }]}>A private assistant{'\n'}in your pocket</Text>
      <View style={styles.points}>
        {POINTS.map((p) => (
          <View key={p.title} style={styles.point}>
            <Icon name={p.icon} size={22} color={t.c.text} style={styles.pointIcon} />
            <View style={styles.flex}>
              <Text style={[styles.pointTitle, { color: t.c.text }]}>{p.title}</Text>
              <Text style={[styles.pointBody, { color: t.c.secondary }]}>{p.body}</Text>
            </View>
          </View>
        ))}
      </View>

      {crashed && (
        <View style={[styles.notice, { backgroundColor: t.c.fill }]}>
          <Icon name="exclamationmark.triangle.fill" size={18} color={t.c.warn} />
          <Text style={[styles.noticeText, { color: t.c.text }]}>
            The app ran out of memory loading a model last time, so the context size is now Small. A
            smaller model may also help.
          </Text>
        </View>
      )}

      <Text style={[styles.section, { color: t.c.secondary }]}>
        {downloaded[pick.id] ? 'Pick up where you left off' : 'Suggested for this iPhone'}
      </Text>
      <View style={[styles.pick, { backgroundColor: t.c.fill }]}>
        <ModelRow t={t} model={pick} />
      </View>
      <Pressable
        onPress={() => router.push('/models')}
        accessibilityRole="button"
        style={({ pressed }) => [styles.all, pressed && styles.dim]}
      >
        <Text style={[styles.allText, { color: t.c.text }]}>See all models</Text>
        <Icon name="chevron.right" size={12} color={t.c.secondary} weight="semibold" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  dim: { opacity: 0.5 },
  emptyBody: { flexGrow: 1, paddingHorizontal: 20 },
  title: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: 220, paddingVertical: 6 },
  titleText: { fontSize: 17, fontWeight: '600', flexShrink: 1 },
  fade: { position: 'absolute', top: 0, left: 0, right: 0 },
  jump: { position: 'absolute', alignSelf: 'center' },
  jumpGlass: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },

  greeting: { flex: 1, justifyContent: 'center', paddingBottom: 40 },
  h1: { fontSize: 32, lineHeight: 38, fontWeight: '700', letterSpacing: -0.6 },
  lead: { fontSize: 17, marginTop: 6 },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 28 },
  card: {
    flexBasis: '47%', flexGrow: 1, borderRadius: 20, borderCurve: 'continuous', padding: 14, gap: 6, minHeight: 112,
  },
  cardTitle: { fontSize: 16, fontWeight: '600', marginTop: 4 },
  cardBody: { fontSize: 14, lineHeight: 19 },

  welcome: { paddingTop: 16 },
  points: { gap: 18, marginTop: 28 },
  point: { flexDirection: 'row', gap: 14 },
  pointIcon: { marginTop: 2 },
  pointTitle: { fontSize: 17, fontWeight: '600' },
  pointBody: { fontSize: 15, lineHeight: 20, marginTop: 1 },
  notice: { flexDirection: 'row', gap: 10, borderRadius: 18, borderCurve: 'continuous', padding: 14, marginTop: 24 },
  noticeText: { flex: 1, fontSize: 14, lineHeight: 19 },
  section: { fontSize: 14, fontWeight: '600', marginTop: 32, marginBottom: 8, marginLeft: 4 },
  pick: { borderRadius: 22, borderCurve: 'continuous', overflow: 'hidden' },
  all: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 18 },
  allText: { fontSize: 16, fontWeight: '500' },
});
