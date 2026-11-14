import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { DownloadState } from './downloads';
import { formatMB, MODELS, type Model } from './models';
import type { Palette } from './theme';

export type EngineState = {
  status: 'none' | 'loading' | 'ready';
  modelId: string | null;
  fraction: number;
  error: string | null;
};

type Props = {
  c: Palette;
  engine: EngineState;
  downloaded: Set<string>;
  downloads: Record<string, DownloadState>;
  onUse: (model: Model) => void;
  onDownload: (model: Model) => void;
  onPause: (model: Model) => void;
  onDelete: (model: Model) => void;
};

export function ModelList({ c, engine, downloaded, downloads, onUse, onDownload, onPause, onDelete }: Props) {
  return (
    <View style={styles.list}>
      {MODELS.map((m) => {
        const active = engine.modelId === m.id && engine.status === 'ready';
        const loading = engine.modelId === m.id && engine.status === 'loading';
        const onDevice = downloaded.has(m.id);
        const dl = downloads[m.id];
        const pct = dl && dl.total ? Math.min(99, Math.round((dl.loaded / dl.total) * 100)) : 0;
        const busy = engine.status === 'loading';

        let state = '';
        if (active) state = 'In use';
        else if (onDevice) state = 'On device';
        else if (dl?.status === 'paused') state = `Paused at ${pct}%`;
        else if (dl?.status === 'failed') state = 'Download failed';

        return (
          <View
            key={m.id}
            style={[styles.card, { backgroundColor: c.surface, borderColor: active ? c.text : c.line }]}
          >
            <View style={styles.top}>
              <View style={styles.flex}>
                <Text style={[styles.name, { color: c.text }]}>{m.name}</Text>
                <Text style={[styles.meta, { color: c.muted }]}>{formatMB(m.sizeMB)} · {m.note}</Text>
                {!!state && <Text style={[styles.state, { color: c.text }]}>{state}</Text>}
              </View>
              <View style={styles.actions}>
                {dl?.status === 'downloading' && (
                  <Pill c={c} quiet label="Pause" onPress={() => onPause(m)} />
                )}
                {!loading && !active && onDevice && (
                  <Pill c={c} label="Use" disabled={busy} onPress={() => onUse(m)} />
                )}
                {!onDevice && dl?.status !== 'downloading' && (
                  <Pill
                    c={c}
                    label={dl?.status === 'paused' ? 'Resume' : dl?.status === 'failed' ? 'Retry' : 'Download'}
                    onPress={() => onDownload(m)}
                  />
                )}
                {!loading && (onDevice || dl) && dl?.status !== 'downloading' && (
                  <Pill c={c} quiet label="Delete" onPress={() => onDelete(m)} />
                )}
              </View>
            </View>

            {dl && (
              <>
                <Bar c={c} fraction={dl.total ? dl.loaded / dl.total : 0} />
                {dl.status === 'downloading' && (
                  <Text style={[styles.meta, { color: c.muted }]}>
                    Downloading {formatMB(dl.loaded / 1e6)} of {formatMB(dl.total / 1e6)}. You can leave the app.
                  </Text>
                )}
                {dl.status === 'failed' && !!dl.error && (
                  <Text style={[styles.meta, { color: c.danger }]}>{dl.error}</Text>
                )}
              </>
            )}
            {loading && (
              <>
                <Bar c={c} fraction={engine.fraction} />
                <Text style={[styles.meta, { color: c.muted }]}>
                  Loading into memory… {Math.round(engine.fraction * 100)}%
                </Text>
              </>
            )}
            {engine.modelId === m.id && !!engine.error && (
              <Text style={[styles.meta, { color: c.danger }]}>{engine.error}</Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

function Bar({ c, fraction }: { c: Palette; fraction: number }) {
  return (
    <View style={[styles.bar, { backgroundColor: c.line }]}>
      <View style={[styles.fill, { backgroundColor: c.accent, width: `${Math.round(fraction * 100)}%` }]} />
    </View>
  );
}

export function Pill({ c, label, onPress, quiet, disabled }: {
  c: Palette; label: string; onPress: () => void; quiet?: boolean; disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => [
        styles.pill,
        !quiet && { backgroundColor: c.accent },
        (pressed || disabled) && styles.dim,
      ]}
    >
      <Text style={[styles.pillText, { color: quiet ? c.muted : c.accentText }, quiet && styles.quiet]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 8 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600' },
  meta: { fontSize: 13, lineHeight: 18 },
  state: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  pill: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999 },
  pillText: { fontSize: 14, fontWeight: '600' },
  quiet: { fontWeight: '500' },
  dim: { opacity: 0.5 },
  bar: { height: 6, borderRadius: 999, overflow: 'hidden' },
  fill: { height: '100%' },
});
