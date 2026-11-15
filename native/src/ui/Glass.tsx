// A Liquid Glass surface where the system has it (iOS 26 and later), and a
// plain raised surface everywhere else.

import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useSimFlags } from '../lib/sim';
import type { Palette } from './theme';

function available(): boolean {
  try {
    return isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
  } catch {
    return false;
  }
}

export const hasGlass = available();

export function Glass({ c, style, interactive, children }: {
  c: Palette;
  style?: StyleProp<ViewStyle>;
  /** Lets the glass respond to touch, for buttons. */
  interactive?: boolean;
  children?: React.ReactNode;
}) {
  // Always true, except in a simulator test that is trying the app without glass.
  const { glass } = useSimFlags();
  if (hasGlass && glass) {
    return (
      <GlassView
        style={style}
        glassEffectStyle="regular"
        colorScheme={c.dark ? 'dark' : 'light'}
        isInteractive={interactive}
      >
        {children}
      </GlassView>
    );
  }
  return (
    <View style={[{ backgroundColor: c.card, borderColor: c.line }, styles.plain, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  plain: {
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
  },
});
