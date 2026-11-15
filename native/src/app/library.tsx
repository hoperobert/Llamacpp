// The offline library: reference material the model can look things up in.

import React from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Stack, useRouter } from 'expo-router';
import {
  addLibraryFile, app, deleteLibraryFile, deleteSource, haptic, installSource, pause,
} from '../lib/app';
import { formatDuration } from '../lib/format';
import { SOURCES, sourceDownload, type Source } from '../lib/library';
import { formatMB } from '../lib/models';
import { Icon } from '../ui/Icon';
import { Row, Section } from '../ui/List';
import { useTheme, type Theme } from '../ui/theme';

export default function LibraryScreen() {
  const t = useTheme();
  const router = useRouter();
  const files = app.use((s) => s.libraryFiles);

  const addFile = async () => {
    const picked = await DocumentPicker.getDocumentAsync({ type: 'text/*', copyToCacheDirectory: true }).catch(() => null);
    const asset = picked && !picked.canceled ? picked.assets[0] : null;
    if (!asset) return;
    const text = await new File(asset.uri).text().catch(() => '');
    const problem = await addLibraryFile(asset.name, text);
    if (problem) Alert.alert('Could Not Add File', problem);
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
        <Section t={t}>
          {SOURCES.map((source) => <SourceRow key={source.id} t={t} source={source} />)}
        </Section>

        <Section t={t} title="Your files">
          {files.map((file) => (
            <Row
              key={file.name} t={t} icon="doc.text" title={file.name}
              right={
                <Pressable
                  onPress={() => { haptic(); deleteLibraryFile(file.name); }}
                  hitSlop={12}
                  accessibilityLabel={`Remove ${file.name}`}
                >
                  <Icon name="xmark.circle.fill" size={20} color={t.c.tertiary} />
                </Pressable>
              }
            />
          ))}
          <Row t={t} icon="plus" title="Add a text file" onPress={addFile} />
        </Section>

        <Text style={[styles.note, { color: t.c.tertiary }]}>Searched on this iPhone when Look up is on.</Text>
      </ScrollView>
    </>
  );
}

/** One downloadable source: get it, watch it arrive and be prepared, or remove it. */
function SourceRow({ t, source }: { t: Theme; source: Source }) {
  const file = sourceDownload(source);
  const dl = app.use((s) => s.downloads[file.id]);
  const state = app.use((s) => s.library[source.id]);

  const downloading = dl?.status === 'downloading' || dl?.status === 'finishing';
  const preparing = state?.status === 'preparing';
  const ready = state?.status === 'ready';
  const fraction = preparing ? state.progress : dl && dl.total ? Math.min(1, dl.loaded / dl.total) : 0;

  let detail = `${source.note} · ${formatMB(source.sizeMB)}`;
  if (ready) detail = `On this iPhone · ${formatMB(source.diskMB)}`;
  else if (preparing) detail = `Preparing ${Math.round(state.progress * 100)}%`;
  else if (dl?.status === 'downloading') {
    const left = dl.speed > 0 ? formatDuration((dl.total - dl.loaded) / dl.speed) : '';
    detail = [`${Math.round(fraction * 100)}%`, left].filter(Boolean).join(' · ');
  } else if (dl?.status === 'finishing') detail = 'Finishing…';
  else if (dl?.status === 'paused') detail = `Paused at ${Math.round(fraction * 100)}%`;
  const error = state?.status === 'failed' ? state.error : dl?.status === 'failed' ? dl.error : undefined;

  const more = () => {
    if (Platform.OS !== 'ios') return;
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ['Remove', 'Cancel'], destructiveButtonIndex: 0, cancelButtonIndex: 1 },
      (index) => { if (index === 0) deleteSource(source); },
    );
  };

  return (
    <View style={styles.source}>
      <View style={styles.top}>
        <Icon name="books.vertical" size={22} color={t.c.text} />
        <View style={styles.flex}>
          <Text style={[styles.name, { color: t.c.text }]}>{source.name}</Text>
          <Text numberOfLines={1} style={[styles.detail, { color: t.c.secondary }]}>{detail}</Text>
        </View>
        {ready ? (
          <Pressable onPress={more} hitSlop={10} accessibilityLabel={`More for ${source.name}`} style={styles.round}>
            <Icon name="ellipsis" size={18} color={t.c.secondary} />
          </Pressable>
        ) : preparing || dl?.status === 'finishing' ? null : dl?.status === 'downloading' ? (
          <Pressable
            onPress={() => pause(file)}
            hitSlop={8}
            accessibilityLabel="Pause"
            style={[styles.round, { backgroundColor: t.c.fill }]}
          >
            <Icon name="pause.fill" size={14} color={t.c.text} />
          </Pressable>
        ) : (
          <Pressable
            onPress={() => installSource(source)}
            hitSlop={8}
            accessibilityRole="button"
            style={({ pressed }) => [styles.pill, { backgroundColor: t.c.fill }, pressed && styles.dim]}
          >
            <Text style={[styles.pillText, { color: t.c.text }]}>
              {dl?.status === 'paused' ? 'Resume' : error ? 'Retry' : 'Get'}
            </Text>
          </Pressable>
        )}
      </View>
      {(downloading || preparing || dl?.status === 'paused') && (
        <View style={[styles.bar, { backgroundColor: t.c.line }]}>
          <View style={[styles.barFill, { backgroundColor: t.c.accent, width: `${Math.round(fraction * 100)}%` }]} />
        </View>
      )}
      {!!error && <Text style={[styles.detail, { color: t.c.danger }]}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { padding: 16, gap: 24, paddingBottom: 48 },
  note: { fontSize: 13, textAlign: 'center' },
  source: { paddingHorizontal: 16, paddingVertical: 13, gap: 10 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontSize: 17, fontWeight: '600' },
  detail: { fontSize: 14, marginTop: 2, fontVariant: ['tabular-nums'] },
  pill: { minWidth: 68, height: 32, borderRadius: 16, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  pillText: { fontSize: 15, fontWeight: '600' },
  round: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  bar: { height: 4, borderRadius: 2, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 2 },
  dim: { opacity: 0.5 },
});
