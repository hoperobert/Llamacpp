// Building blocks for settings-style screens: rounded groups of rows, the way
// the iOS Settings app lays them out.

import React from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { haptic } from '../lib/app';
import { Icon, type IconName } from './Icon';
import type { Theme } from './theme';

export function Section({ t, title, footer, children }: {
  t: Theme; title?: string; footer?: string; children: React.ReactNode;
}) {
  const rows = React.Children.toArray(children);
  return (
    <View style={styles.section}>
      {!!title && <Text style={[styles.header, { color: t.c.secondary }]}>{title}</Text>}
      <View style={[styles.card, { backgroundColor: t.c.card }]}>
        {rows.map((row, i) => (
          <React.Fragment key={i}>
            {i > 0 && <View style={[styles.separator, { backgroundColor: t.c.line }]} />}
            {row}
          </React.Fragment>
        ))}
      </View>
      {!!footer && <Text style={[styles.footer, { color: t.c.secondary }]}>{footer}</Text>}
    </View>
  );
}

export function Row({ t, title, subtitle, value, icon, onPress, chevron, tone, right }: {
  t: Theme;
  title: string;
  subtitle?: string;
  /** Short text shown on the right, such as the current choice. */
  value?: string;
  icon?: IconName;
  onPress?: () => void;
  chevron?: boolean;
  tone?: 'danger';
  right?: React.ReactNode;
}) {
  const color = tone === 'danger' ? t.c.danger : t.c.text;
  const body = (
    <View style={styles.row}>
      {icon && <Icon name={icon} size={20} color={color} style={styles.rowIcon} />}
      <View style={styles.flex}>
        <Text style={[styles.title, { color }]}>{title}</Text>
        {!!subtitle && <Text style={[styles.subtitle, { color: t.c.secondary }]}>{subtitle}</Text>}
      </View>
      {!!value && <Text numberOfLines={1} style={[styles.value, { color: t.c.secondary }]}>{value}</Text>}
      {right}
      {chevron && <Icon name="chevron.right" size={13} color={t.c.tertiary} weight="semibold" />}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && { backgroundColor: t.c.fill }}>
      {body}
    </Pressable>
  );
}

export function SwitchRow({ t, title, subtitle, value, onChange }: {
  t: Theme; title: string; subtitle?: string; value: boolean; onChange: (value: boolean) => void;
}) {
  return (
    <Row
      t={t}
      title={title}
      subtitle={subtitle}
      right={<Switch value={value} onValueChange={(v) => { haptic('select'); onChange(v); }} />}
    />
  );
}

/** A row with a label above a segmented control. */
export function ChoiceRow<T extends string | number>({ t, title, subtitle, value, options, onChange }: {
  t: Theme;
  title: string;
  subtitle?: string;
  value: T;
  options: { label: string; value: T }[];
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.choice}>
      <Text style={[styles.title, { color: t.c.text }]}>{title}</Text>
      <Segmented t={t} value={value} options={options} onChange={onChange} />
      {!!subtitle && <Text style={[styles.subtitle, { color: t.c.secondary }]}>{subtitle}</Text>}
    </View>
  );
}

export function Segmented<T extends string | number>({ t, value, options, onChange }: {
  t: Theme; value: T; options: { label: string; value: T }[]; onChange: (value: T) => void;
}) {
  return (
    <View style={[styles.segments, { backgroundColor: t.c.dark ? '#2c2c2e' : '#e9e9ee' }]}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => { if (!selected) { haptic('select'); onChange(o.value); } }}
            style={[
              styles.segment,
              selected && [styles.segmentOn, { backgroundColor: t.c.dark ? '#636366' : '#ffffff' }],
            ]}
          >
            <Text
              numberOfLines={1}
              style={[styles.segmentText, { color: t.c.text }, selected && styles.segmentTextOn]}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: { gap: 7 },
  header: { fontSize: 14, fontWeight: '600', marginLeft: 16 },
  footer: { fontSize: 13, lineHeight: 18, marginHorizontal: 16 },
  card: { borderRadius: 22, borderCurve: 'continuous', overflow: 'hidden' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    minHeight: 50, paddingHorizontal: 16, paddingVertical: 11,
  },
  rowIcon: { marginRight: 2 },
  title: { fontSize: 17 },
  subtitle: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  value: { fontSize: 17, maxWidth: '55%' },
  choice: { paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  segments: { flexDirection: 'row', borderRadius: 100, padding: 3 },
  segment: { flex: 1, minHeight: 32, borderRadius: 100, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  segmentOn: {
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 },
  },
  segmentText: { fontSize: 14, fontWeight: '500' },
  segmentTextOn: { fontWeight: '600' },
});
