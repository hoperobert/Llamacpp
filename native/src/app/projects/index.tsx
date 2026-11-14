// Projects: groups of chats that share instructions.

import React from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { app, createProject } from '../../lib/app';
import { Icon } from '../../ui/Icon';
import { Row, Section } from '../../ui/List';
import { useTheme } from '../../ui/theme';

export default function ProjectsScreen() {
  const t = useTheme();
  const router = useRouter();
  const projects = app.use((s) => s.projects);
  const chatList = app.use((s) => s.chatList);

  const add = () => {
    if (Platform.OS !== 'ios') {
      const project = createProject('New project');
      if (project) router.push(`/projects/${project.id}`);
      return;
    }
    Alert.prompt('New Project', undefined, (name) => {
      const project = createProject(name);
      if (project) router.push(`/projects/${project.id}`);
    });
  };

  return (
    <>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="plus" accessibilityLabel="New project" onPress={add} />
      </Stack.Toolbar>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.body}>
        {projects.length > 0 ? (
          <Section t={t}>
            {projects.map((p) => {
              const count = chatList.filter((c) => c.projectId === p.id).length;
              return (
                <Row
                  key={p.id} t={t} icon="folder" title={p.name}
                  value={count ? String(count) : undefined}
                  chevron onPress={() => router.push(`/projects/${p.id}`)}
                />
              );
            })}
          </Section>
        ) : (
          <View style={styles.empty}>
            <Icon name="folder" size={34} color={t.c.tertiary} />
            <Text style={[styles.emptyText, { color: t.c.secondary }]}>Group chats that share instructions.</Text>
          </View>
        )}
        <Section t={t}>
          <Row t={t} icon="folder.badge.plus" title="New project" onPress={add} />
        </Section>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 24, paddingBottom: 48 },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 36 },
  emptyText: { fontSize: 15 },
});
