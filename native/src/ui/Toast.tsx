// A short message that appears above the message box and fades away.

import React, { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { app } from '../lib/app';
import { Glass } from './Glass';
import { useTheme } from './theme';

export function Toast({ bottom }: { bottom: number }) {
  const t = useTheme();
  const text = app.use((s) => s.toast);
  const [opacity] = useState(() => new Animated.Value(0));
  // Keep the words on screen while the toast fades out.
  const [shown, setShown] = useState(text);
  if (text && text !== shown) setShown(text);

  useEffect(() => {
    Animated.timing(opacity, { toValue: text ? 1 : 0, duration: 180, useNativeDriver: true }).start();
  }, [text, opacity]);

  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, { bottom, opacity }]}>
      <Glass c={t.c} style={styles.pill}>
        <Text style={[styles.text, { color: t.c.text }]}>{shown}</Text>
      </Glass>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  pill: { borderRadius: 100, paddingHorizontal: 16, paddingVertical: 10, maxWidth: '86%' },
  text: { fontSize: 15, fontWeight: '500', textAlign: 'center' },
});
