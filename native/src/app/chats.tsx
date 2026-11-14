// The list of saved chats, with search.

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActionSheetIOS, Alert, Platform, Pressable, SectionList, StyleSheet, Text, View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { app, haptic, openChat, removeChat, renameChat, shareChat, togglePin } from '../lib/app';
import { dayGroup, shortTime } from '../lib/format';
import { store, type Chat, type ChatMeta } from '../lib/storage';
import { Icon } from '../ui/Icon';
import { useTheme } from '../ui/theme';

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

export default function ChatsScreen() {
  const t = useTheme();
  const router = useRouter();
  const chatList = app.use((s) => s.chatList);
  const currentId = app.use((s) => s.chat.id);
  const [query, setQuery] = useState('');
  const [bodies, setBodies] = useState<Chat[] | null>(null);

  // The words inside chats are only read from storage once someone searches.
  const searching = query.trim().length > 0;
  useEffect(() => {
    if (searching && !bodies) store.allChats().then(setBodies);
  }, [searching, bodies]);

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    let items: Item[] = chatList;
    if (q) {
      const byId = new Map((bodies ?? []).map((c) => [c.id, c]));
      items = [];
      for (const meta of chatList) {
        const body = byId.get(meta.id);
        const snippet = body ? snippetFor(body, q) : undefined;
        if (meta.title.toLowerCase().includes(q) || snippet) items.push({ ...meta, snippet });
      }
      return items.length ? [{ title: 'Results', data: items }] : [];
    }
    const groups = new Map<string, Item[]>();
    const add = (title: string, item: Item) => groups.set(title, [...(groups.get(title) ?? []), item]);
    for (const item of items) add(item.pinned ? 'Pinned' : dayGroup(item.updatedAt), item);
    // Pinned first; the date groups are already in order because the list is newest first.
    return [...groups.entries()]
      .sort(([a], [b]) => (a === 'Pinned' ? -1 : b === 'Pinned' ? 1 : 0))
      .map(([title, data]) => ({ title, data }));
  }, [chatList, query, bodies]);

  const open = async (id: string | null) => {
    haptic('select');
    await openChat(id);
    router.back();
  };

  const more = (item: ChatMeta) => {
    if (Platform.OS !== 'ios') return;
    haptic();
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: item.title,
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
    <>
      <Stack.Screen
        options={{
          headerSearchBarOptions: {
            placeholder: 'Search chats',
            hideWhenScrolling: false,
            onChangeText: (e) => setQuery(e.nativeEvent.text),
            onCancelButtonPress: () => setQuery(''),
          },
        }}
      />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="square.and.pencil" accessibilityLabel="New chat" onPress={() => open(null)} />
      </Stack.Toolbar>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        stickySectionHeadersEnabled={false}
        style={{ backgroundColor: t.c.bg }}
        contentContainerStyle={styles.body}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="text.bubble" size={34} color={t.c.tertiary} />
            <Text style={[styles.emptyTitle, { color: t.c.text }]}>
              {searching ? 'No Results' : 'No Chats Yet'}
            </Text>
            <Text style={[styles.emptyBody, { color: t.c.secondary }]}>
              {searching ? 'Try a different word.' : 'Your chats are saved on this iPhone and listed here.'}
            </Text>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Text style={[styles.header, { color: t.c.secondary }]}>{section.title}</Text>
        )}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => open(item.id)}
            onLongPress={() => more(item)}
            delayLongPress={320}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.row,
              (pressed || item.id === currentId) && { backgroundColor: t.c.fill },
            ]}
          >
            <View style={styles.flex}>
              <View style={styles.titleRow}>
                {item.pinned && <Icon name="pin.fill" size={12} color={t.c.secondary} />}
                <Text numberOfLines={1} style={[styles.title, { color: t.c.text }]}>{item.title}</Text>
              </View>
              {!!item.snippet && (
                <Text numberOfLines={2} style={[styles.snippet, { color: t.c.secondary }]}>{item.snippet}</Text>
              )}
            </View>
            <Text style={[styles.time, { color: t.c.tertiary }]}>{shortTime(item.updatedAt)}</Text>
            <Pressable onPress={() => more(item)} hitSlop={10} accessibilityLabel={`More for ${item.title}`}>
              <Icon name="ellipsis" size={18} color={t.c.tertiary} />
            </Pressable>
          </Pressable>
        )}
      />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { paddingHorizontal: 10, paddingBottom: 40, flexGrow: 1 },
  header: { fontSize: 14, fontWeight: '600', marginLeft: 12, marginTop: 20, marginBottom: 6 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    minHeight: 50, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 14, borderCurve: 'continuous',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 17, flexShrink: 1 },
  snippet: { fontSize: 14, lineHeight: 19, marginTop: 2 },
  time: { fontSize: 14, fontVariant: ['tabular-nums'] },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 40, paddingBottom: 80 },
  emptyTitle: { fontSize: 20, fontWeight: '700', marginTop: 8 },
  emptyBody: { fontSize: 15, lineHeight: 20, textAlign: 'center' },
});
