// One project: its name, its instructions and its chats.

import React, { useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { app, deleteProject, newChat, openChat, updateProject } from '../../lib/app';
import { Row, Section } from '../../ui/List';
import { useTheme } from '../../ui/theme';

export default function ProjectScreen() {
  const t = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const project = app.use((s) => s.projects.find((p) => p.id === id));
  const chatList = app.use((s) => s.chatList);
  const [instructions, setInstructions] = useState(() => project?.instructions ?? '');

  if (!project) return null;
  const chats = chatList.filter((c) => c.projectId === project.id);

  // Closes the whole projects sheet, whichever of its pages is showing, to reveal the chat.
  const show = async (chatId: string | null) => {
    if (chatId) await openChat(chatId);
    else newChat({ projectId: project.id });
    const sheet = navigation.getParent();
    if (sheet?.canGoBack()) sheet.goBack();
    else router.back();
  };

  const rename = () => {
    if (Platform.OS !== 'ios') return;
    Alert.prompt('Rename Project', undefined, (name) => {
      if (name.trim()) updateProject(project.id, { name: name.trim().slice(0, 60) });
    }, 'plain-text', project.name);
  };

  return (
    <>
      <Stack.Screen options={{ title: project.name }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="More">
          <Stack.Toolbar.MenuAction icon="pencil" onPress={rename}>Rename</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="trash" destructive onPress={() => deleteProject(project, () => router.back())}>
            Delete
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <Section t={t}>
          <Row t={t} icon="plus.circle.fill" title="New chat" onPress={() => show(null)} />
        </Section>

        <Section t={t} title="Instructions">
          <View style={styles.card}>
            <TextInput
              multiline
              value={instructions}
              onChangeText={(text) => { setInstructions(text); updateProject(project.id, { instructions: text }); }}
              placeholder="What should every chat here know or do?"
              placeholderTextColor={t.c.tertiary}
              style={[styles.input, { color: t.c.text }]}
            />
          </View>
        </Section>

        {chats.length > 0 && (
          <Section t={t} title="Chats">
            {chats.map((c) => <Row key={c.id} t={t} title={c.title} chevron onPress={() => show(c.id)} />)}
          </Section>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 24, paddingBottom: 48 },
  card: { padding: 16 },
  input: { fontSize: 17, lineHeight: 23, minHeight: 110, textAlignVertical: 'top', padding: 0 },
});
