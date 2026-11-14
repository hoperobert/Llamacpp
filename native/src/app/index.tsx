// The chat.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import {
  app, contextUse, findModel, newChat, removeChat, renameChat, send, shareChat, summariseNow, togglePin,
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
import { serif, useTheme, type Theme } from '../ui/theme';

const SUGGESTIONS: { icon: IconName; title: string; prompt: string }[] = [
  { icon: 'graduationcap', title: 'Explain', prompt: 'Explain how vaccines work in simple terms' },
  { icon: 'pencil', title: 'Write', prompt: 'Write a friendly text to reschedule dinner' },
  { icon: 'list.bullet.clipboard', title: 'Plan', prompt: 'Give me a 3-day plan to learn the basics of chess' },
  { icon: 'fork.knife', title: 'Cook', prompt: 'Suggest a quick dinner I can make with eggs, rice and spinach' },
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
            contentContainerStyle={[styles.emptyBody, { paddingTop: headerHeight, paddingBottom: composerHeight + 8 }]}
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
              <Icon name="arrow.down" size={18} color={t.c.text} weight="semibold" />
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
      `${used.toLocaleString()} of ${settings.nCtx.toLocaleString()} tokens used.`,
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
      <Stack.Screen options={{ headerTitle: () => <TitlePill onPress={hasMessages ? rename : undefined} /> }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button
          icon="line.3.horizontal"
          accessibilityLabel="Chats"
          onPress={() => router.push('/chats')}
        />
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="More">
          <Stack.Toolbar.MenuAction icon="square.and.pencil" disabled={!hasMessages} onPress={newChat}>
            New Chat
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="gauge.with.dots.needle.33percent" hidden={!hasMessages} onPress={showContext}>
            {`Context ${percent}% Full`}
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.Menu inline>
            <Stack.Toolbar.MenuAction icon="square.and.arrow.up" hidden={!hasMessages} onPress={() => shareChat(chat.id)}>
              Share
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
              Delete
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
          <Stack.Toolbar.MenuAction icon="gearshape" onPress={() => router.push('/settings')}>
            Settings
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
    </>
  );
}

/** The chat's name over the model's, in a glass pill in the middle of the header. */
function TitlePill({ onPress }: { onPress?: () => void }) {
  const t = useTheme();
  const title = app.use((s) => (s.chat.messages.length ? s.chat.title : 'New chat'));
  const engine = app.use((s) => s.engine);
  const busy = app.use((s) => s.busy);
  const model = findModel(engine.modelId);
  const subtitle = engine.status === 'loading'
    ? `Loading ${Math.round(engine.fraction * 100)}%`
    : engine.status === 'ready' && model ? (busy ? `${model.name} · Writing` : model.name) : 'No model';
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole="header" style={({ pressed }) => pressed && styles.dim}>
      <Glass c={t.c} style={styles.pill}>
        <Text numberOfLines={1} style={[styles.pillTitle, { color: t.c.text }]}>{title}</Text>
        <Text numberOfLines={1} style={[styles.pillSub, { color: t.c.secondary }]}>{subtitle}</Text>
      </Glass>
    </Pressable>
  );
}

// ---------- empty states ----------

function Greeting({ t }: { t: Theme }) {
  const busy = app.use((s) => s.busy);
  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Up late?' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return (
    <View style={styles.centre}>
      <Icon name="sparkles" size={30} color={t.c.accent} />
      <Text style={[styles.h1, { color: t.c.text }]}>{greeting}</Text>
      <View style={styles.chips}>
        {SUGGESTIONS.map((s) => (
          <Pressable
            key={s.title}
            onPress={() => { if (!busy) send(s.prompt); }}
            accessibilityRole="button"
            accessibilityLabel={s.prompt}
            style={({ pressed }) => [styles.chip, { borderColor: t.c.line }, pressed && { backgroundColor: t.c.fill }]}
          >
            <Icon name={s.icon} size={15} color={t.c.secondary} />
            <Text style={[styles.chipText, { color: t.c.text }]}>{s.title}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Welcome({ t }: { t: Theme }) {
  const router = useRouter();
  const crashed = app.use((s) => s.crashed);
  const settings = app.use((s) => s.settings);
  const downloaded = app.use((s) => s.downloaded);
  // Offer the model used last time if it is still here, otherwise a good first pick.
  const last = findModel(settings.modelId);
  const pick = last && downloaded[last.id] ? last : recommended(ramMB);
  return (
    <View style={styles.centre}>
      <Icon name="sparkles" size={30} color={t.c.accent} />
      <Text style={[styles.h1, { color: t.c.text }]}>Private AI,{'\n'}on your iPhone</Text>
      {crashed && (
        <Text style={[styles.notice, { color: t.c.warn }]}>
          The last model ran out of memory. Try a smaller one.
        </Text>
      )}
      <View style={[styles.pick, { backgroundColor: t.c.card, borderColor: t.c.line }]}>
        <ModelRow t={t} model={pick} />
      </View>
      <Pressable
        onPress={() => router.push('/models')}
        hitSlop={10}
        accessibilityRole="button"
        style={({ pressed }) => pressed && styles.dim}
      >
        <Text style={[styles.all, { color: t.c.secondary }]}>All models</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  dim: { opacity: 0.5 },
  emptyBody: { flexGrow: 1, paddingHorizontal: 20 },
  fade: { position: 'absolute', top: 0, left: 0, right: 0 },
  jump: { position: 'absolute', alignSelf: 'center' },
  jumpGlass: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  pill: {
    height: 44, borderRadius: 22, paddingHorizontal: 20, maxWidth: 230,
    alignItems: 'center', justifyContent: 'center',
  },
  pillTitle: { fontSize: 15, fontWeight: '700' },
  pillSub: { fontSize: 12, marginTop: -1 },

  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, paddingBottom: 30 },
  h1: { fontFamily: serif, fontSize: 34, lineHeight: 40, textAlign: 'center', letterSpacing: -0.3 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 6 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: 100, paddingHorizontal: 14, paddingVertical: 9,
  },
  chipText: { fontSize: 15 },
  notice: { fontSize: 14, textAlign: 'center' },
  pick: {
    alignSelf: 'stretch', borderRadius: 20, borderCurve: 'continuous', overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth, marginTop: 10,
  },
  all: { fontSize: 15, fontWeight: '500' },
});
