// One model in a list: what it is, whether it suits this iPhone, and the
// button that gets it, pauses it or switches to it.

import React from 'react';
import { ActionSheetIOS, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { app, download, pause, removeModel, switchModel } from '../lib/app';
import { ramMB } from '../lib/device';
import { formatDuration, formatSpeed } from '../lib/format';
import { fit, formatMB, type Model } from '../lib/models';
import { Icon } from './Icon';
import type { Theme } from './theme';

export const ModelRow = React.memo(function ModelRow({ t, model, onUsed }: {
  t: Theme;
  model: Model;
  /** Called after the user picks this model to chat with. */
  onUsed?: () => void;
}) {
  const dl = app.use((s) => s.downloads[model.id]);
  const onDevice = app.use((s) => !!s.downloaded[model.id]);
  const loadingThis = app.use((s) => s.engine.modelId === model.id && s.engine.status === 'loading');
  const active = app.use((s) => s.engine.modelId === model.id && s.engine.status === 'ready');
  const fraction = app.use((s) => (s.engine.modelId === model.id ? s.engine.fraction : 0));
  const error = app.use((s) => (s.engine.modelId === model.id ? s.engine.error : null));
  const engineBusy = app.use((s) => s.engine.status === 'loading');

  const suits = fit(model, ramMB);
  const downloading = dl?.status === 'downloading';
  const finishing = dl?.status === 'finishing';
  const progress = dl && dl.total ? Math.min(1, dl.loaded / dl.total) : 0;

  const more = () => {
    if (Platform.OS !== 'ios') return;
    const partial = !!dl && !onDevice;
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: model.name,
        options: [partial ? 'Cancel Download' : 'Delete', 'Close'],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 1,
      },
      (index) => { if (index === 0) removeModel(model); },
    );
  };

  let detail = '';
  if (downloading) {
    const left = dl.speed > 0 ? formatDuration((dl.total - dl.loaded) / dl.speed) : '';
    detail = [`${formatMB(dl.loaded / 1e6)} of ${formatMB(dl.total / 1e6)}`, formatSpeed(dl.speed), left]
      .filter(Boolean).join(' · ');
  } else if (finishing) {
    detail = 'Finishing…';
  } else if (dl?.status === 'paused') {
    detail = dl.loaded > 0 ? `Paused at ${Math.round(progress * 100)}%` : 'Paused';
  } else if (loadingThis) {
    detail = `Loading ${Math.round(fraction * 100)}%`;
  }

  return (
    <Pressable onLongPress={onDevice || dl ? more : undefined} delayLongPress={320} style={styles.row}>
      <View style={styles.top}>
        <View style={styles.flex}>
          <Text style={[styles.name, { color: t.c.text }]}>{model.name}</Text>
          <Text numberOfLines={1} style={[styles.meta, { color: suits === 'tight' ? t.c.warn : t.c.secondary }]}>
            {[model.sizeMB ? formatMB(model.sizeMB) : '', suits === 'tight' ? 'Tight fit' : model.note]
              .filter(Boolean).join(' · ')}
          </Text>
        </View>

        {active ? (
          <View style={styles.inUse}>
            <Icon name="checkmark.circle.fill" size={18} color={t.c.good} />
            <Text style={[styles.inUseText, { color: t.c.good }]}>In use</Text>
          </View>
        ) : finishing ? null : downloading ? (
          <Circle t={t} icon="pause.fill" label="Pause" onPress={() => pause(model)} />
        ) : onDevice ? (
          <Pill
            t={t} filled label={loadingThis ? 'Loading' : 'Use'} disabled={engineBusy}
            onPress={() => { switchModel(model); onUsed?.(); }}
          />
        ) : (
          <Pill
            t={t}
            label={dl?.status === 'paused' ? 'Resume' : dl?.status === 'failed' ? 'Retry' : 'Get'}
            onPress={() => download(model)}
          />
        )}
        {(onDevice || dl) && !downloading && !finishing && (
          <Pressable onPress={more} hitSlop={10} accessibilityLabel={`More for ${model.name}`} style={styles.more}>
            <Icon name="ellipsis" size={18} color={t.c.secondary} />
          </Pressable>
        )}
      </View>

      {(dl || loadingThis) && (
        <View style={[styles.bar, { backgroundColor: t.c.line }]}>
          <View
            style={[
              styles.barFill,
              { backgroundColor: t.c.accent, width: `${Math.round((loadingThis ? fraction : progress) * 100)}%` },
            ]}
          />
        </View>
      )}
      {!!detail && <Text style={[styles.detail, { color: t.c.secondary }]}>{detail}</Text>}
      {dl?.status === 'failed' && (
        <Text style={[styles.detail, { color: t.c.danger }]}>{dl.error || 'The download failed.'}</Text>
      )}
      {!!error && <Text style={[styles.detail, { color: t.c.danger }]}>{error}</Text>}
    </Pressable>
  );
});

function Pill({ t, label, onPress, filled, disabled }: {
  t: Theme; label: string; onPress: () => void; filled?: boolean; disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: filled ? t.c.accent : t.c.fill },
        (pressed || disabled) && styles.dim,
      ]}
    >
      <Text style={[styles.pillText, { color: filled ? t.c.onAccent : t.c.text }]}>{label}</Text>
    </Pressable>
  );
}

function Circle({ t, icon, label, onPress }: {
  t: Theme; icon: 'pause.fill'; label: string; onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.circle, { backgroundColor: t.c.fill }, pressed && styles.dim]}
    >
      <Icon name={icon} size={14} color={t.c.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { paddingHorizontal: 16, paddingVertical: 13, gap: 8 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontSize: 17, fontWeight: '600' },
  meta: { fontSize: 14, marginTop: 2 },
  pill: { minWidth: 68, height: 32, borderRadius: 16, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  pillText: { fontSize: 15, fontWeight: '600' },
  circle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  more: { width: 28, height: 32, alignItems: 'center', justifyContent: 'center' },
  inUse: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  inUseText: { fontSize: 15, fontWeight: '600' },
  bar: { height: 4, borderRadius: 2, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 2 },
  detail: { fontSize: 13, lineHeight: 18, fontVariant: ['tabular-nums'] },
  dim: { opacity: 0.5 },
});
