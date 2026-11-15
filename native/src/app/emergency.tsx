// For when something has gone wrong and there may be no signal: light and
// noise to be found by, where the phone is, first aid and survival steps that
// need no model, and a check that everything the app needs is on the phone.

import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import {
  allModels, app, changeSettings, copyText, download, getPython, haptic, installSource, shareText,
} from '../lib/app';
import { CALL, CARDS, cardText, type Card } from '../lib/firstaid';
import { sourceDownload, SOURCES } from '../lib/library';
import { formatMB } from '../lib/models';
import { alarm, allOff, battery, heading, screenBrightness, torch, whereAmI, type Place } from '../lib/phone';
import { PYTHON_MB } from '../lib/runner';
import { hasNative } from '../../modules/pocket-native';
import { Icon, type IconName } from '../ui/Icon';
import { Row, Section, SwitchRow } from '../ui/List';
import { useTheme, type Theme } from '../ui/theme';

// SOS in Morse: three short, three long, three short. Each pair is light on or off, and for how many beats.
const BEAT = 220;
const SOS: [boolean, number][] = [
  ...[1, 1, 1].flatMap((): [boolean, number][] => [[true, 1], [false, 1]]), [false, 2],
  ...[1, 1, 1].flatMap((): [boolean, number][] => [[true, 3], [false, 1]]), [false, 2],
  ...[1, 1, 1].flatMap((): [boolean, number][] => [[true, 1], [false, 1]]), [false, 6],
];

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (degrees: number) => `${POINTS[Math.round(degrees / 45) % 8]} (${Math.round(degrees)}°)`;
const fixed = (place: Place) => `${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}`;

export default function EmergencyScreen() {
  const t = useTheme();
  const router = useRouter();
  const emergency = app.use((s) => s.settings.emergency);
  const [light, setLight] = useState(false);
  const [sos, setSos] = useState(false);
  const [lit, setLit] = useState(false);
  const [loud, setLoud] = useState(false);
  const [screen, setScreen] = useState(false);
  const [place, setPlace] = useState<Place | null | 'looking' | 'none'>(null);
  const [facing, setFacing] = useState<number | null>(null);
  const [power, setPower] = useState<{ level: number | null; saving: boolean } | null>(null);
  const [openCard, setOpenCard] = useState<string | null>(null);
  const was = useRef(-1);
  const flashing = useRef(0);

  useEffect(() => {
    battery().then(setPower);
    return () => {
      flashing.current += 1;
      allOff();
      if (was.current >= 0) screenBrightness(was.current);
    };
  }, []);

  const toggleTorch = () => {
    haptic();
    stopSos();
    torch(light ? 0 : 1);
    setLight(!light);
  };

  const stopSos = () => {
    flashing.current += 1;
    setSos(false);
    setLit(false);
  };
  const toggleSos = () => {
    haptic();
    if (sos) {
      stopSos();
      torch(0);
      return;
    }
    setLight(false);
    setSos(true);
    const mine = ++flashing.current;
    let at = 0;
    const next = () => {
      if (flashing.current !== mine) return;
      const [on, beats] = SOS[at % SOS.length];
      at += 1;
      torch(on ? 1 : 0);
      setLit(on);
      setTimeout(next, beats * BEAT);
    };
    next();
  };

  const toggleAlarm = () => {
    haptic();
    alarm(!loud);
    setLoud(!loud);
  };

  // The whole screen white and as bright as it goes: a lamp, and a light to be seen by.
  const toggleScreen = async () => {
    haptic();
    if (screen) {
      if (was.current >= 0) screenBrightness(was.current);
      was.current = -1;
    } else {
      was.current = await screenBrightness(1);
    }
    setScreen(!screen);
  };

  const find = async () => {
    haptic();
    setPlace('looking');
    const [found, direction] = await Promise.all([whereAmI(), heading()]);
    setPlace(found ?? 'none');
    setFacing(direction);
  };
  const found = place && place !== 'looking' && place !== 'none' ? place : null;
  const help = found
    ? `I need help. I am at ${fixed(found)}${found.accuracy ? ` (within ${Math.round(found.accuracy)} m)` : ''}. https://maps.apple.com/?ll=${found.latitude.toFixed(5)},${found.longitude.toFixed(5)}`
    : '';

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
        <Text style={[styles.call, { color: t.c.text }]}>
          In danger? {CALL} first. An emergency call can use any network in range.
        </Text>

        <View style={styles.grid}>
          {hasNative && <Big t={t} icon={light ? 'flashlight.on.fill' : 'flashlight.off.fill'} label="Torch" on={light} onPress={toggleTorch} />}
          <Big t={t} icon="bolt.fill" label="Flash SOS" on={sos} onPress={toggleSos} />
          {hasNative && <Big t={t} icon="speaker.wave.3" label="Alarm" on={loud} onPress={toggleAlarm} />}
          <Big t={t} icon="sun.max" label="Screen light" on={screen} onPress={toggleScreen} />
        </View>
        {!hasNative && (
          <Text style={[styles.note, { color: t.c.tertiary }]}>
            The torch, an alarm and your location come with the next version of the app.
          </Text>
        )}

        {hasNative && <Section t={t} title="Where I am" footer="This comes from GPS, which needs no signal or internet. Outdoors under open sky is best.">
          {found ? (
            <>
              <Row
                t={t} icon="location" title={fixed(found)}
                subtitle={[
                  found.accuracy ? `Within ${Math.round(found.accuracy)} m` : '',
                  found.altitude !== null ? `${Math.round(found.altitude)} m up` : '',
                  facing !== null ? `Facing ${compass(facing)}` : '',
                ].filter(Boolean).join(' · ')}
              />
              <Row t={t} icon="doc.on.doc" title="Copy" onPress={() => copyText(fixed(found))} />
              <Row t={t} icon="square.and.arrow.up" title="Send to someone" onPress={() => shareText(help)} />
              <Row t={t} icon="arrow.clockwise" title="Find again" onPress={find} />
            </>
          ) : (
            <Row
              t={t} icon="location"
              title={place === 'looking' ? 'Finding…' : 'Find where I am'}
              subtitle={place === 'none' ? 'Could not tell. Allow location for Pocket LLM in Settings, and try outdoors.' : undefined}
              onPress={place === 'looking' ? undefined : find}
            />
          )}
        </Section>}

        <Section
          t={t} title="Answers"
          footer="Short, practical replies that put the most important thing first, checked against the library on this iPhone. Easier on the battery."
        >
          <SwitchRow t={t} title="Emergency mode" value={emergency} onChange={(on) => changeSettings({ emergency: on })} />
          {!!power && power.level !== null && (
            <Row
              t={t} icon="battery.75percent" title="Battery"
              value={`${Math.round(power.level * 100)}%${power.saving ? ' · Low Power Mode' : ''}`}
            />
          )}
        </Section>

        {(['first aid', 'survival'] as const).map((group) => (
          <Section key={group} t={t} title={group === 'first aid' ? 'First aid' : 'With no help coming'}>
            {CARDS.filter((card) => card.group === group).map((card) => (
              <CardRow key={card.id} t={t} card={card} open={openCard === card.id} onPress={() => setOpenCard(openCard === card.id ? null : card.id)} />
            ))}
          </Section>
        ))}

        <Ready t={t} />

        <Text style={[styles.note, { color: t.c.tertiary }]}>
          A reminder for when there is nothing better to hand. It is not training, and not a doctor.
        </Text>
      </ScrollView>

      {(screen || sos) && (
        <Pressable
          onPress={screen ? toggleScreen : toggleSos}
          accessibilityLabel="Turn off"
          style={[StyleSheet.absoluteFill, styles.lamp, { backgroundColor: screen || lit ? '#ffffff' : '#000000' }]}
        >
          <Text style={[styles.lampText, { color: screen || lit ? '#00000055' : '#ffffff66' }]}>
            {screen ? 'Tap to turn off' : 'SOS · tap to stop'}
          </Text>
        </Pressable>
      )}
    </>
  );
}

function Big({ t, icon, label, on, onPress }: { t: Theme; icon: IconName; label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={({ pressed }) => [styles.big, { backgroundColor: on ? t.c.accent : t.c.card }, pressed && styles.dim]}
    >
      <Icon name={icon} size={26} color={on ? t.c.onAccent : t.c.text} />
      <Text style={[styles.bigLabel, { color: on ? t.c.onAccent : t.c.text }]}>{label}</Text>
    </Pressable>
  );
}

function CardRow({ t, card, open, onPress }: { t: Theme; card: Card; open: boolean; onPress: () => void }) {
  return (
    <View>
      <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.cardHead, pressed && { backgroundColor: t.c.fill }]}>
        <Text style={[styles.cardTitle, { color: t.c.text }]}>{card.title}</Text>
        <Icon name={open ? 'chevron.down' : 'chevron.right'} size={13} color={t.c.tertiary} weight="semibold" />
      </Pressable>
      {open && (
        <View style={styles.cardBody}>
          {!!card.signs && <Text style={[styles.signs, { color: t.c.secondary }]}>{card.signs}</Text>}
          {card.steps.map((step, i) => (
            <View key={i} style={styles.step}>
              <Text style={[styles.stepNumber, { color: t.c.accent }]}>{i + 1}</Text>
              <Text selectable style={[styles.stepText, { color: t.c.text, fontSize: t.size, lineHeight: t.size * 1.4 }]}>{step}</Text>
            </View>
          ))}
          {card.never?.map((line) => (
            <Text key={line} selectable style={[styles.never, { color: t.c.danger, fontSize: t.size - 1 }]}>{line}</Text>
          ))}
          <Pressable onPress={() => shareText(cardText(card))} hitSlop={8} accessibilityRole="button" style={styles.share}>
            <Icon name="square.and.arrow.up" size={15} color={t.c.secondary} />
            <Text style={[styles.shareText, { color: t.c.secondary }]}>Share these steps</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/** Whether what the app needs is on the phone, and a way to fetch what is not while there is still a connection. */
function Ready({ t }: { t: Theme }) {
  const downloaded = app.use((s) => s.downloaded);
  const downloads = app.use((s) => s.downloads);
  const library = app.use((s) => s.library);
  const python = app.use((s) => s.python);

  const models = allModels();
  const have = models.filter((m) => downloaded[m.id]);
  const smallest = [...models].sort((a, b) => a.sizeMB - b.sizeMB)[0];
  const medicine = SOURCES.find((s) => s.id === 'medicine');
  const howto = SOURCES.find((s) => s.id === 'howto');

  const state = (id: string, ready: boolean) => {
    const dl = downloads[id];
    if (ready) return 'On this iPhone';
    if (dl?.status === 'downloading') return `${dl.total ? Math.round((dl.loaded / dl.total) * 100) : 0}%`;
    if (dl?.status === 'finishing') return 'Finishing…';
    return '';
  };
  const sourceRow = (source: typeof medicine, wanted: boolean) => {
    if (!source) return null;
    const file = sourceDownload(source);
    const ready = library[source.id]?.status === 'ready';
    const busy = library[source.id]?.status === 'preparing' ? `Preparing ${Math.round((library[source.id]?.progress ?? 0) * 100)}%` : state(file.id, ready);
    return (
      <Row
        key={source.id} t={t} icon={ready ? 'checkmark.circle.fill' : 'arrow.down.circle'}
        title={source.name} subtitle={wanted ? undefined : 'Optional'}
        value={busy || `Get · ${formatMB(source.sizeMB)}`}
        onPress={ready || busy ? undefined : () => installSource(source)}
      />
    );
  };
  const modelBusy = smallest ? state(smallest.id, false) : '';
  const missing =
    (have.length ? 0 : smallest?.sizeMB ?? 0) +
    (medicine && library[medicine.id]?.status !== 'ready' ? medicine.sizeMB : 0) +
    (python.status === 'ready' || !hasNative ? 0 : PYTHON_MB);
  const getAll = () => {
    haptic();
    if (!have.length && smallest && !downloads[smallest.id]) download(smallest);
    if (medicine && library[medicine.id]?.status !== 'ready' && !downloads[sourceDownload(medicine).id]) installSource(medicine);
    if (hasNative && python.status === 'missing') getPython();
  };

  return (
    <Section
      t={t} title="Ready with no internet?"
      footer="Fetch these while you have a connection. After that the app needs nothing from outside: try it in Airplane Mode."
    >
      <Row
        t={t} icon={have.length ? 'checkmark.circle.fill' : 'arrow.down.circle'} title="A model"
        value={have.length ? (have.length === 1 ? have[0].name : `${have.length} on this iPhone`) : modelBusy || (smallest ? `Get · ${formatMB(smallest.sizeMB)}` : '')}
        onPress={have.length || modelBusy || !smallest ? undefined : () => download(smallest)}
      />
      {sourceRow(medicine, true)}
      {hasNative && <Row
        t={t} icon={python.status === 'ready' ? 'checkmark.circle.fill' : 'arrow.down.circle'} title="Python"
        value={python.status === 'ready' ? 'On this iPhone' : python.status === 'downloading' ? `${Math.round(python.fraction * 100)}%` : `Get · ${PYTHON_MB} MB`}
        onPress={python.status === 'missing' ? () => { haptic(); getPython(); } : undefined}
      />}
      {sourceRow(howto, false)}
      {missing > 0 && <Row t={t} icon="arrow.down" title="Get everything missing" value={formatMB(missing)} onPress={getAll} />}
      <Row t={t} icon="checkmark.circle.fill" title="First aid and survival steps" value="Built in" />
    </Section>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 24, paddingBottom: 48 },
  call: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  big: {
    flexGrow: 1, flexBasis: '45%', height: 92, borderRadius: 22, borderCurve: 'continuous',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  bigLabel: { fontSize: 15, fontWeight: '600' },
  dim: { opacity: 0.6 },
  cardHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  cardTitle: { flex: 1, fontSize: 17 },
  cardBody: { paddingHorizontal: 16, paddingBottom: 16, gap: 10 },
  signs: { fontSize: 15, lineHeight: 21 },
  step: { flexDirection: 'row', gap: 10 },
  stepNumber: { width: 18, fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] },
  stepText: { flex: 1 },
  never: { lineHeight: 21, fontWeight: '500' },
  share: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, alignSelf: 'flex-start' },
  shareText: { fontSize: 14 },
  note: { fontSize: 13, textAlign: 'center', lineHeight: 18 },
  lamp: { alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 60 },
  lampText: { fontSize: 15, fontWeight: '600' },
});
