// Runs a block of code the model wrote: a script for what it prints, a web
// page to be looked at. The code runs shut away from the app, with no internet.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { app, copyText, haptic, tellModel } from '../lib/app';
import { failed, outputText, reportFor, runnerPage, type Line } from '../lib/runner';
import { Icon, type IconName } from '../ui/Icon';
import { Sandbox } from '../ui/Sandbox';
import { useTheme, type Theme } from '../ui/theme';

/** More lines than this and the oldest are dropped, so a runaway loop cannot fill the phone. */
const MOST_LINES = 500;

export default function RunScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const run = app.use((s) => s.run);
  const [attempt, setAttempt] = useState(1);
  const [lines, setLines] = useState<Line[]>([]);
  const [running, setRunning] = useState(true);
  const [slow, setSlow] = useState(false);
  // The script's page is kept after it finishes, for anything it prints later (a timer, say). Stop closes it.
  const [open, setOpen] = useState(true);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);

  const page = run?.kind === 'page';
  const html = useMemo(() => (run ? runnerPage(run.kind, run.code) : ''), [run]);

  const onLine = useCallback((line: Line) => {
    if (line.kind === 'done') setRunning(false);
    else setLines((had) => [...had, line].slice(-MOST_LINES));
  }, []);

  // A script that has not finished after a while is probably going round in circles.
  useEffect(() => {
    if (page || !running) return;
    const timer = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(timer);
  }, [page, running, attempt]);

  const again = () => {
    haptic();
    setLines([]);
    setSlow(false);
    setRunning(true);
    setOpen(true);
    setAttempt((n) => n + 1);
  };
  const stopIt = () => {
    haptic();
    setRunning(false);
    setSlow(false);
    setOpen(false);
    setLines((had) => [...had, { kind: 'warn', text: 'Stopped.' }]);
  };
  const tell = () => {
    haptic();
    router.back();
    tellModel(reportFor(lines));
  };

  if (!run) return null;

  const wrong = failed(lines);
  const output = outputText(lines, 100000);
  const status = page
    ? ''
    : running ? (slow ? 'Still running…' : 'Running…')
    : wrong ? 'Went wrong' : output ? 'Finished' : 'Finished. Nothing was printed.';

  return (
    <View style={[styles.flex, { backgroundColor: t.c.bg }]}>
      <Stack.Screen options={{ title: page ? 'Preview' : 'Run' }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
      </Stack.Toolbar>

      {page ? (
        <>
          <Sandbox key={attempt} html={html} onLine={onLine} style={styles.page} />
          {!!lines.length && (
            <ScrollView style={[styles.problems, { borderTopColor: t.c.line }]} contentContainerStyle={styles.lines}>
              <Output lines={lines} t={t} />
            </ScrollView>
          )}
        </>
      ) : (
        <ScrollView
          ref={scroll}
          style={styles.flex}
          contentContainerStyle={styles.lines}
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
        >
          <Text style={[styles.status, { color: wrong ? t.c.danger : t.c.secondary }]}>{status}</Text>
          <Output lines={lines} t={t} />
          {/* The script itself draws nothing; it only has to be on the screen to run. */}
          {open && <Sandbox key={attempt} html={html} onLine={onLine} style={styles.unseen} />}
        </ScrollView>
      )}

      <View style={[styles.bar, { borderTopColor: t.c.line, paddingBottom: Math.max(insets.bottom, 12) }]}>
        {running && !page ? (
          <Button t={t} icon="stop.fill" label="Stop" onPress={stopIt} />
        ) : (
          <Button t={t} icon="arrow.clockwise" label={page ? 'Reload' : 'Run again'} onPress={again} />
        )}
        {!!output && <Button t={t} icon="doc.on.doc" label="Copy" onPress={() => copyText(output)} />}
        {!running && !page && <Button t={t} icon="arrow.up" label={wrong ? 'Ask to fix' : 'Send result'} strong onPress={tell} />}
        {page && wrong && <Button t={t} icon="arrow.up" label="Ask to fix" strong onPress={tell} />}
      </View>
    </View>
  );
}

function Output({ lines, t }: { lines: Line[]; t: Theme }) {
  const colour = { log: t.c.text, result: t.c.text, done: t.c.text, warn: t.c.warn, error: t.c.danger, blocked: t.c.warn };
  return (
    <>
      {lines.map((line, i) => (
        <Text key={i} selectable style={[styles.mono, { color: colour[line.kind], fontSize: t.size - 3 }]}>
          {line.kind === 'blocked' ? `Not loaded, no internet in here: ${line.text}` : line.text}
        </Text>
      ))}
    </>
  );
}

function Button({ t, icon, label, onPress, strong }: {
  t: Theme; icon: IconName; label: string; onPress: () => void; strong?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button, { backgroundColor: strong ? t.c.accent : t.c.fill }, pressed && styles.dim,
      ]}
    >
      <Icon name={icon} size={14} color={strong ? t.c.onAccent : t.c.text} />
      <Text style={[styles.buttonText, { color: strong ? t.c.onAccent : t.c.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // A page is written for a white background unless it says otherwise.
  page: { flex: 1, backgroundColor: '#ffffff' },
  unseen: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  problems: { maxHeight: 140, flexGrow: 0, borderTopWidth: StyleSheet.hairlineWidth },
  lines: { padding: 16, gap: 6 },
  status: { fontSize: 14, marginBottom: 6 },
  mono: { fontFamily: 'Menlo', lineHeight: 20 },
  bar: {
    flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  button: {
    flexDirection: 'row', alignItems: 'center', gap: 7, height: 40, paddingHorizontal: 16,
    borderRadius: 20, borderCurve: 'continuous',
  },
  buttonText: { fontSize: 15, fontWeight: '600' },
  dim: { opacity: 0.5 },
});
