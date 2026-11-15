// Runs code the model wrote: a script or Python for what it prints, a web page
// to be looked at and used. The code runs shut away from the app, with no
// internet. What is worth keeping can be saved as a tool and opened again from
// Tools, where it also keeps whatever it stores.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { app, copyText, getPython, haptic, keepToolData, saveTool, tellModel } from '../lib/app';
import { allOff, askPhone } from '../lib/phone';
import { pythonAddress } from '../lib/python';
import { failed, outputText, PYTHON_MB, reportFor, runnerPage, type Line } from '../lib/runner';
import { Icon, type IconName } from '../ui/Icon';
import { Sandbox } from '../ui/Sandbox';
import { useTheme, type Theme } from '../ui/theme';

/** More lines than this and the oldest are dropped, so a runaway loop cannot fill the phone. */
const MOST_LINES = 500;

/** Asks for a name. The browser preview has no such alert of its own. */
function askName(title: string, suggestion: string, then: (name: string) => void) {
  if (Platform.OS === 'ios') {
    Alert.prompt(title, 'It is kept in Tools and works with no internet.', (name) => { if (name?.trim()) then(name); }, 'plain-text', suggestion);
  } else {
    const name = (globalThis as { prompt?: (text: string, value: string) => string | null }).prompt?.(title, suggestion);
    if (name?.trim()) then(name);
  }
}

export default function RunScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const run = app.use((s) => s.run);
  const tool = app.use((s) => s.tools.find((x) => x.id === s.run?.toolId));
  const changing = app.use((s) => s.tools.find((x) => x.id === s.changing));
  const python = app.use((s) => s.python);
  const [attempt, setAttempt] = useState(1);
  const [lines, setLines] = useState<Line[]>([]);
  const [running, setRunning] = useState(true);
  const [slow, setSlow] = useState(false);
  // The script's page is kept after it finishes, for anything it prints later (a timer, say). Stop closes it.
  const [open, setOpen] = useState(true);
  // Where Python's page is loaded from on this phone. Null until it is found, false if it cannot be.
  const [address, setAddress] = useState<string | null | false>(null);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);

  const page = run?.kind === 'page';
  const isPython = run?.kind === 'python';
  const toolId = run?.toolId;
  // What a saved tool stored last time is given back to it as it starts, and not again while it runs.
  const html = useMemo(
    () => (run && run.kind !== 'python' ? runnerPage(run.kind, run.code, app.get().tools.find((x) => x.id === run.toolId)?.data) : ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run?.kind, run?.code, run?.toolId, attempt],
  );

  useEffect(() => {
    if (!isPython || python.status !== 'ready') return;
    let gone = false;
    pythonAddress().then((found) => { if (!gone) setAddress(found ?? false); });
    return () => { gone = true; };
  }, [isPython, python.status]);

  // Whatever the code switched on (the torch, the alarm) goes off with the screen.
  useEffect(() => allOff, []);

  const onLine = useCallback((line: Line) => {
    if (line.kind === 'done') setRunning(false);
    else if (line.kind === 'store') {
      try {
        const { key, value } = JSON.parse(line.text);
        keepToolData(toolId, String(key), value === null ? null : String(value));
      } catch {
        // Not something to keep.
      }
    } else if (line.kind !== 'ready') setLines((had) => [...had, line].slice(-MOST_LINES));
  }, [toolId]);

  // A script that has not finished after a while is probably going round in circles.
  useEffect(() => {
    if (page || !running) return;
    const timer = setTimeout(() => setSlow(true), isPython ? 20000 : 8000);
    return () => clearTimeout(timer);
  }, [page, isPython, running, attempt]);

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
  const save = () => {
    if (changing) {
      Alert.alert(`Update ${changing.name}?`, 'This version takes its place. What it has stored is kept.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Save as new', onPress: () => askName('Save as a tool', '', (name) => saveTool(name)) },
        { text: 'Update', onPress: () => saveTool(changing.name, changing.id) },
      ]);
    } else {
      askName('Save as a tool', '', (name) => saveTool(name));
    }
  };

  if (!run) return null;

  const wrong = failed(lines);
  const output = outputText(lines, 100000);
  const title = tool?.name ?? (page ? 'Preview' : 'Run');
  const needsPython = isPython && python.status !== 'ready';
  const cannotServe = isPython && python.status === 'ready' && address === false;
  const status = page || needsPython || cannotServe
    ? ''
    : running ? (slow ? 'Still running…' : isPython ? 'Starting Python…' : 'Running…')
    : wrong ? 'Went wrong' : output ? 'Finished' : 'Finished. Nothing was printed.';
  const started = lines.length > 0;

  return (
    <View style={[styles.flex, { backgroundColor: t.c.bg }]}>
      <Stack.Screen options={{ title }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
      </Stack.Toolbar>

      {needsPython || cannotServe ? (
        <View style={styles.offer}>
          <Icon name="arrow.down.circle" size={34} color={t.c.secondary} />
          <Text style={[styles.offerTitle, { color: t.c.text }]}>
            {cannotServe ? 'Python needs the newest version of the app' : 'Python is a one-off download'}
          </Text>
          <Text style={[styles.offerText, { color: t.c.secondary }]}>
            {cannotServe
              ? 'Update Pocket LLM in TestFlight, then run this again.'
              : `${PYTHON_MB} MB, kept on this iPhone. After that Python runs with no internet.`}
          </Text>
          {!!python.error && <Text style={[styles.offerText, { color: t.c.danger }]}>{python.error}</Text>}
          {needsPython && (python.status === 'downloading' ? (
            <View style={[styles.track, { backgroundColor: t.c.line }]}>
              <View style={[styles.trackFill, { backgroundColor: t.c.accent, width: `${Math.round(python.fraction * 100)}%` }]} />
            </View>
          ) : (
            <Button t={t} icon="arrow.down" label={python.error ? 'Try again' : 'Get Python'} strong onPress={() => { haptic(); getPython(); }} />
          ))}
        </View>
      ) : page ? (
        <>
          <Sandbox key={attempt} html={html} onLine={onLine} onAsk={askPhone} style={styles.page} />
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
          <Text style={[styles.status, { color: wrong ? t.c.danger : t.c.secondary }]}>
            {isPython && running && started && !slow ? 'Running…' : status}
          </Text>
          <Output lines={lines} t={t} />
          {/* The script itself draws nothing; it only has to be on the screen to run. */}
          {open && (isPython
            ? !!address && <Sandbox key={attempt} address={address} code={run.code} onLine={onLine} onAsk={askPhone} style={styles.unseen} />
            : <Sandbox key={attempt} html={html} onLine={onLine} onAsk={askPhone} style={styles.unseen} />)}
        </ScrollView>
      )}

      {!needsPython && !cannotServe && (
        <View style={[styles.bar, { borderTopColor: t.c.line, paddingBottom: Math.max(insets.bottom, 12) }]}>
          {running && !page ? (
            <Button t={t} icon="stop.fill" label="Stop" onPress={stopIt} />
          ) : (
            <Button t={t} icon="arrow.clockwise" label={page ? 'Reload' : 'Run again'} onPress={again} />
          )}
          {!!output && <Button t={t} icon="doc.on.doc" label="Copy" quiet onPress={() => copyText(output)} />}
          {(!tool || !!changing) && <Button t={t} icon="bookmark" label="Save" quiet={!page} onPress={save} />}
          <View style={styles.flex} />
          {!running && !page && <Button t={t} icon="arrow.up" label={wrong ? 'Ask to fix' : 'Send result'} strong onPress={tell} />}
          {page && wrong && <Button t={t} icon="arrow.up" label="Ask to fix" strong onPress={tell} />}
        </View>
      )}
    </View>
  );
}

function Output({ lines, t }: { lines: Line[]; t: Theme }) {
  const colour = (kind: Line['kind']) => (kind === 'error' ? t.c.danger : kind === 'warn' || kind === 'blocked' ? t.c.warn : t.c.text);
  return (
    <>
      {lines.map((line, i) => (
        <Text key={i} selectable style={[styles.mono, { color: colour(line.kind), fontSize: t.size - 3 }]}>
          {line.kind === 'blocked' ? `Not loaded, no internet in here: ${line.text}` : line.text}
        </Text>
      ))}
    </>
  );
}

/** A button in the bar. A quiet one is only its picture, to leave room for the others. */
function Button({ t, icon, label, onPress, strong, quiet }: {
  t: Theme; icon: IconName; label: string; onPress: () => void; strong?: boolean; quiet?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.button, quiet && styles.quiet, { backgroundColor: strong ? t.c.accent : t.c.fill }, pressed && styles.dim,
      ]}
    >
      <Icon name={icon} size={quiet ? 16 : 14} color={strong ? t.c.onAccent : t.c.text} />
      {!quiet && <Text style={[styles.buttonText, { color: strong ? t.c.onAccent : t.c.text }]}>{label}</Text>}
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
  offer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  offerTitle: { fontSize: 20, fontWeight: '600', textAlign: 'center' },
  offerText: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
  track: { alignSelf: 'stretch', height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 8 },
  trackFill: { height: '100%', borderRadius: 3 },
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  button: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 40, paddingHorizontal: 16,
    borderRadius: 20, borderCurve: 'continuous',
  },
  quiet: { width: 40, paddingHorizontal: 0 },
  buttonText: { fontSize: 15, fontWeight: '600' },
  dim: { opacity: 0.5 },
});
