// The sheet behind the "+" in the message box: add a photo, and choose how
// the next replies are written.

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { app, attachPhoto, changeSettings, download, findModel, pickFile } from '../lib/app';
import { formatMB, visionAddon } from '../lib/models';
import { hasNative } from '../../modules/pocket-native';
import { STYLES } from '../lib/storage';
import { ChoiceRow, Row, Section, SwitchRow } from '../ui/List';
import { useTheme, type Theme } from '../ui/theme';

export default function OptionsSheet() {
  const t = useTheme();
  const router = useRouter();
  const settings = app.use((s) => s.settings);
  // There is something to look things up in once a source is ready or a file has been added.
  const hasLibrary = app.use((s) => s.libraryFiles.length > 0 || Object.values(s.library).some((l) => l.status === 'ready'));
  return (
    <View style={[styles.body, { backgroundColor: t.c.grouped }]}>
      <PhotoRow t={t} />
      <Section t={t}>
        <SwitchRow t={t} title="Think first" value={settings.thinking} onChange={(thinking) => changeSettings({ thinking })} />
        {hasLibrary ? (
          <SwitchRow t={t} title="Look up" value={settings.lookup} onChange={(lookup) => changeSettings({ lookup })} />
        ) : (
          <Row t={t} title="Look up" value="Add a library" chevron onPress={() => router.replace('/library')} />
        )}
        <ChoiceRow
          t={t} title="Style" value={settings.style}
          onChange={(style) => changeSettings({ style })}
          options={STYLES.map((s) => ({ label: s.label, value: s.id }))}
        />
        <ChoiceRow
          t={t} title="Length" value={settings.maxTokens}
          onChange={(maxTokens) => changeSettings({ maxTokens })}
          options={[{ label: 'Short', value: 256 }, { label: 'Medium', value: 768 }, { label: 'Long', value: 1536 }, { label: 'Max', value: 3072 }]}
        />
      </Section>
    </View>
  );
}

/**
 * Adding a photo or a file. A model that can look at photos is shown the photo.
 * Any other model is given the words read out of it, and offered the add-on
 * that lets it look, if it has one.
 */
function PhotoRow({ t }: { t: Theme }) {
  const router = useRouter();
  const engine = app.use((s) => s.engine);
  const model = findModel(engine.modelId);
  const addon = model ? visionAddon(model) : null;
  const onDevice = app.use((s) => (addon ? !!s.downloaded[addon.id] : false));
  const progress = app.use((s) => (addon ? s.downloads[addon.id] : undefined));
  if (engine.status !== 'ready') return null;

  // Reading the words in a photo needs a part of the app an older build does not have.
  const photos = engine.vision || hasNative;
  const attach = (
    <>
      {photos && (
        <Row
          t={t} icon="photo" title={engine.vision ? 'Photo library' : 'Read text in a photo'}
          onPress={async () => { await attachPhoto('library'); router.back(); }}
        />
      )}
      {photos && (
        <Row
          t={t} icon="camera" title={engine.vision ? 'Take photo' : 'Read text with the camera'}
          onPress={async () => { await attachPhoto('camera'); router.back(); }}
        />
      )}
      <Row t={t} icon="doc.text" title="File" onPress={async () => { await pickFile(); router.back(); }} />
    </>
  );
  if (engine.vision || !addon) return <Section t={t}>{attach}</Section>;
  const percent = progress && progress.total ? Math.round((progress.loaded / progress.total) * 100) : 0;
  return (
    <Section t={t}>
      {attach}
      <Row
        t={t} icon="sparkles" title="Let this model see photos"
        value={
          progress?.status === 'downloading' ? `${percent}%`
          : progress?.status === 'finishing' ? 'Finishing…'
          : progress?.status === 'paused' ? 'Resume'
          : progress?.status === 'failed' ? 'Retry'
          : onDevice ? 'Loading…' : `Get · ${formatMB(addon.sizeMB)}`
        }
        onPress={
          onDevice || progress?.status === 'downloading' || progress?.status === 'finishing'
            ? undefined : () => download(addon)
        }
      />
    </Section>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: 16, paddingTop: 28, gap: 16 },
});
