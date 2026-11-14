// The sheet behind the "+" in the message box: add a photo, and choose how
// the next replies are written.

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { app, attachPhoto, changeSettings, download, findModel } from '../lib/app';
import { formatMB, visionAddon } from '../lib/models';
import { STYLES } from '../lib/storage';
import { ChoiceRow, Row, Section, SwitchRow } from '../ui/List';
import { useTheme, type Theme } from '../ui/theme';

export default function OptionsSheet() {
  const t = useTheme();
  const settings = app.use((s) => s.settings);
  return (
    <View style={[styles.body, { backgroundColor: t.c.grouped }]}>
      <PhotoRow t={t} />
      <Section t={t}>
        <SwitchRow t={t} title="Think first" value={settings.thinking} onChange={(thinking) => changeSettings({ thinking })} />
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

/** Adding a photo, or getting the add-on that lets this model look at one. Hidden for models that cannot. */
function PhotoRow({ t }: { t: Theme }) {
  const router = useRouter();
  const engine = app.use((s) => s.engine);
  const model = findModel(engine.modelId);
  const addon = model ? visionAddon(model) : null;
  const onDevice = app.use((s) => (addon ? !!s.downloaded[addon.id] : false));
  const progress = app.use((s) => (addon ? s.downloads[addon.id] : undefined));
  if (!addon || engine.status !== 'ready') return null;

  if (engine.vision) {
    return (
      <Section t={t}>
        <Row t={t} icon="photo" title="Add photo" onPress={async () => { await attachPhoto(); router.back(); }} />
      </Section>
    );
  }
  const percent = progress && progress.total ? Math.round((progress.loaded / progress.total) * 100) : 0;
  return (
    <Section t={t}>
      <Row
        t={t} icon="photo" title="Photos"
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
