// Tools: what the model built that was worth keeping. Each opens and runs with
// no internet, keeps what it stores, and can be changed by asking.

import React from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { app, changeTool, deleteTool, openTool, renameTool, shareText } from '../lib/app';
import type { Tool } from '../lib/storage';
import { Icon } from '../ui/Icon';
import { Row, Section } from '../ui/List';
import { useTheme } from '../ui/theme';

const KINDS = { page: 'Page', script: 'JavaScript', python: 'Python' } as const;

function more(tool: Tool) {
  if (Platform.OS !== 'ios') return;
  ActionSheetIOS.showActionSheetWithOptions(
    { title: tool.name, options: ['Change it…', 'Rename', 'Share its code', 'Delete', 'Cancel'], destructiveButtonIndex: 3, cancelButtonIndex: 4 },
    (index) => {
      if (index === 0) changeTool(tool.id);
      else if (index === 1) Alert.prompt('Rename', undefined, (name) => renameTool(tool.id, name ?? ''), 'plain-text', tool.name);
      else if (index === 2) shareText(tool.code);
      else if (index === 3) deleteTool(tool.id);
    },
  );
}

export default function ToolsScreen() {
  const t = useTheme();
  const router = useRouter();
  const tools = app.use((s) => s.tools);

  const ask = () => {
    app.set({ draft: '/tool ' });
    router.back();
  };

  return (
    <>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
      </Stack.Toolbar>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: t.c.grouped }}
        contentContainerStyle={styles.body}
      >
        {tools.length > 0 && (
          <Section t={t}>
            {tools.map((tool) => (
              <Row
                key={tool.id} t={t}
                icon={tool.kind === 'page' ? 'globe' : 'chevron.left.forwardslash.chevron.right'}
                title={tool.name}
                subtitle={KINDS[tool.kind]}
                onPress={() => openTool(tool.id)}
                right={
                  <Pressable onPress={() => more(tool)} hitSlop={12} accessibilityLabel={`More for ${tool.name}`} style={styles.round}>
                    <Icon name="ellipsis" size={18} color={t.c.secondary} />
                  </Pressable>
                }
              />
            ))}
          </Section>
        )}
        <Section t={t} footer={tools.length ? undefined : 'Ask for something useful: a tip calculator, a packing checklist, a unit converter, a water tracker. Open what comes back with Preview or Run, then save it. It works with no internet from then on.'}>
          <Row t={t} icon="plus" title="Ask for a new tool" onPress={ask} />
        </Section>
        <Text style={[styles.note, { color: t.c.tertiary }]}>Tools run on this iPhone, shut away from the app and the internet.</Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 24, paddingBottom: 48 },
  note: { fontSize: 13, textAlign: 'center' },
  round: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
