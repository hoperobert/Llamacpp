// The model library: what is on this iPhone, and what can be added. Models
// too big for this iPhone are left out.

import React, { useMemo } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { addCustomModel, app } from '../lib/app';
import { freeDiskMB, ramMB } from '../lib/device';
import { fileSizeMB } from '../lib/downloads';
import { fit, formatMB, GROUPS, MODELS, type Model } from '../lib/models';
import { Row, Section } from '../ui/List';
import { ModelRow } from '../ui/ModelRow';
import { useTheme } from '../ui/theme';

export default function ModelsScreen() {
  const t = useTheme();
  const router = useRouter();
  const downloaded = app.use((s) => s.downloaded);
  // Which downloads exist matters here, not their progress, so this only changes when one starts or ends.
  const downloadIds = app.use((s) => Object.keys(s.downloads).join(','));
  const customModels = app.use((s) => s.customModels);

  const { mine, groups, usedMB } = useMemo(() => {
    const all: Model[] = [...MODELS, ...customModels];
    const inProgress = new Set(downloadIds.split(','));
    const isMine = (m: Model) => !!downloaded[m.id] || inProgress.has(m.id);
    return {
      mine: all.filter(isMine),
      groups: GROUPS
        .map((group) => ({
          ...group,
          models: all.filter((m) => m.group === group.id && !isMine(m) && fit(m, ramMB) !== 'no'),
        }))
        .filter((group) => group.models.length),
      usedMB: all.reduce((sum, m) => sum + (downloaded[m.id] ? fileSizeMB(m) : 0), 0),
    };
  }, [downloaded, customModels, downloadIds]);

  const free = freeDiskMB();
  const storage = [
    usedMB ? `${formatMB(usedMB)} used` : '',
    free !== null ? `${formatMB(free)} free` : '',
  ].filter(Boolean).join(' · ');

  const addFromLink = () => {
    if (Platform.OS !== 'ios') return;
    Alert.prompt(
      'Add a Model',
      'Paste a link to a .gguf file.',
      (link) => {
        const problem = addCustomModel(link);
        if (problem) Alert.alert('Could Not Add Model', problem);
      },
      'plain-text',
      '',
      'url',
    );
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
        {mine.length > 0 && (
          <Section t={t} title="On this iPhone">
            {mine.map((m) => <ModelRow key={m.id} t={t} model={m} onUsed={() => router.back()} />)}
          </Section>
        )}
        {groups.map((group) => (
          <Section key={group.id} t={t} title={group.title}>
            {group.models.map((m) => <ModelRow key={m.id} t={t} model={m} />)}
          </Section>
        ))}
        <Section t={t}>
          <Row t={t} icon="link" title="Add from a link" onPress={addFromLink} chevron />
        </Section>
        {!!storage && <Text style={[styles.storage, { color: t.c.tertiary }]}>{storage}</Text>}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 24, paddingBottom: 48 },
  storage: { fontSize: 13, textAlign: 'center' },
});
