// The side menu: saved chats, search, and the way into Settings. It slides in
// over the chat from the left.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionSheetIOS, Alert, Animated, PanResponder, Platform, Pressable, SectionList, StyleSheet, Text,
  TextInput, useWindowDimensions, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { app, haptic, openChat, removeChat, renameChat, shareChat, togglePin } from '../lib/app';
import { dayGroup } from '../lib/format';
import { store, type Chat, type ChatMeta } from '../lib/storage';
import { Icon, type IconName } from '../ui/Icon';
import { useTheme, type Theme } from '../ui/theme';

type Item = ChatMeta & { snippet?: string };

/** A few words around the first place the search text appears in a chat. */
function snippetFor(chat: Chat, query: string): string | undefined {
  for (const message of chat.messages) {
    const at = message.content.toLowerCase().indexOf(query);
    if (at >= 0) {
      const from = Math.max(0, at - 30);
      return (from > 0 ? '…' : '') + message.content.slice(from, at + 70).replace(/\s+/g, ' ');
    }
  }
  return undefined;
}

export default function ChatsMenu() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screen } = useWindowDimensions();
  const width = Math.min(340, Math.round(screen * 0.84));

  const chatList = app.use((s) => s.chatList);
  const currentId = app.use((s) => s.chat.id);
  const [query, setQuery] = useState('');
  const [bodies, setBodies] = useState<Chat[] | null>(null);
  const [slide] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.spring(slide, { toValue: 1, useNativeDriver: true, bounciness: 0, speed: 18 }).start();
  }, [slide]);

  const close = useCallback((then?: () => void) => {
    Animated.timing(slide, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => {
      router.back();
      then?.();
    });
  }, [slide, router]);

  // Dragging the menu to the left closes it.
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => g.dx < -12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderMove: (_, g) => slide.setValue(Math.max(0, Math.min(1, 1 + g.dx / width))),
    onPanResponderRelease: (_, g) => {
      if (g.dx < -width * 0.3 || g.vx < -0.6) close();
      else Animated.spring(slide, { toValue: 1, useNativeDriver: true, bounciness: 0 }).start();
    },
  }), [slide, width, close]);

  // The words inside chats are only read from storage once someone searches.
  const searching = query.trim().length > 0;
  useEffect(() => {
    if (searching && !bodies) store.allChats().then(setBodies);
  }, [searching, bodies]);

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      const byId = new Map((bodies ?? []).map((c) => [c.id, c]));
      const items: Item[] = [];
      for (const meta of chatList) {
        const body = byId.get(meta.id);
        const snippet = body ? snippetFor(body, q) : undefined;
        if (meta.title.toLowerCase().includes(q) || snippet) items.push({ ...meta, snippet });
      }
      return items.length ? [{ title: 'Results', data: items }] : [];
    }
    const groups = new Map<string, Item[]>();
    for (const item of chatList) {
      const title = item.pinned ? 'Pinned' : dayGroup(item.updatedAt);
      groups.set(title, [...(groups.get(title) ?? []), item]);
    }
    // Pinned first; the date groups are already in order because the list is newest first.
    return [...groups.entries()]
      .sort(([a], [b]) => (a === 'Pinned' ? -1 : b === 'Pinned' ? 1 : 0))
      .map(([title, data]) => ({ title, data }));
  }, [chatList, query, bodies]);

  const open = async (id: string | null) => {
    haptic('select');
    await openChat(id);
    close();
  };

  const more = (item: ChatMeta) => {
    if (Platform.OS !== 'ios') return;
    haptic();
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ['Rename', item.pinned ? 'Unpin' : 'Pin', 'Share…', 'Delete', 'Cancel'],
        destructiveButtonIndex: 3,
        cancelButtonIndex: 4,
      },
      (index) => {
        if (index === 0) {
          Alert.prompt('Rename Chat', undefined, (title) => renameChat(item.id, title), 'plain-text', item.title);
        } else if (index === 1) togglePin(item);
        else if (index === 2) shareChat(item.id);
        else if (index === 3) removeChat(item);
      },
    );
  };

  return (
    <View style={styles.flex}>
      <Animated.View style={[styles.scrim, { opacity: slide.interpolate({ inputRange: [0, 1], outputRange: [0, 0.35] }) }]}>
        <Pressable style={styles.flex} onPress={() => close()} accessibilityLabel="Close menu" />
      </Animated.View>
      <Animated.View
        {...pan.panHandlers}
        style={[
          styles.panel,
          {
            width, backgroundColor: t.c.grouped, paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, 12),
            transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] }) }],
          },
        ]}
      >
        <View style={[styles.search, { backgroundColor: t.c.fill }]}>
          <Icon name="magnifyingglass" size={16} color={t.c.tertiary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search"
            placeholderTextColor={t.c.tertiary}
            returnKeyType="search"
            clearButtonMode="while-editing"
            autoCorrect={false}
            style={[styles.searchInput, { color: t.c.text }]}
          />
        </View>

        <Link t={t} icon="plus.circle.fill" label="New chat" accent onPress={() => open(null)} />

        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          stickySectionHeadersEnabled={false}
          showsVerticalScrollIndicator={false}
          style={styles.flex}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: t.c.tertiary }]}>{searching ? 'No results' : 'No chats yet'}</Text>
          }
          renderSectionHeader={({ section }) => (
            <Text style={[styles.header, { color: t.c.tertiary }]}>{section.title}</Text>
          )}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => open(item.id)}
              onLongPress={() => more(item)}
              delayLongPress={320}
              accessibilityRole="button"
              style={({ pressed }) => [styles.row, (pressed || item.id === currentId) && { backgroundColor: t.c.fill }]}
            >
              <Text numberOfLines={1} style={[styles.title, { color: t.c.text }]}>{item.title}</Text>
              {!!item.snippet && (
                <Text numberOfLines={1} style={[styles.snippet, { color: t.c.secondary }]}>{item.snippet}</Text>
              )}
            </Pressable>
          )}
        />

        <View style={[styles.rule, { backgroundColor: t.c.line }]} />
        <Link t={t} icon="gearshape" label="Settings" onPress={() => close(() => router.push('/settings'))} />
      </Animated.View>
    </View>
  );
}

function Link({ t, icon, label, onPress, accent }: {
  t: Theme; icon: IconName; label: string; onPress: () => void; accent?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.link, pressed && { backgroundColor: t.c.fill }]}
    >
      <Icon name={icon} size={20} color={accent ? t.c.accent : t.c.text} />
      <Text style={[styles.linkText, { color: accent ? t.c.accent : t.c.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrim: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: '#000' },
  panel: { position: 'absolute', top: 0, bottom: 0, left: 0, paddingHorizontal: 10 },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    height: 40, borderRadius: 12, borderCurve: 'continuous', paddingHorizontal: 12, marginBottom: 8,
  },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 0 },
  link: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    height: 46, paddingHorizontal: 10, borderRadius: 12, borderCurve: 'continuous',
  },
  linkText: { fontSize: 16, fontWeight: '500' },
  header: { fontSize: 13, fontWeight: '500', marginLeft: 10, marginTop: 18, marginBottom: 4 },
  row: { justifyContent: 'center', minHeight: 42, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 12, borderCurve: 'continuous' },
  title: { fontSize: 16 },
  snippet: { fontSize: 13, marginTop: 2 },
  empty: { fontSize: 15, marginLeft: 10, marginTop: 18 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 6 },
});
