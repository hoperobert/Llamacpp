import React, { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { app, changeSettings } from '../../lib/app';
import { useTheme } from '../../ui/theme';

export default function InstructionsScreen() {
  const t = useTheme();
  const [text, setText] = useState(() => app.get().settings.instructions);
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.body}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      <View style={[styles.card, { backgroundColor: t.c.card }]}>
        <TextInput
          multiline
          autoFocus={!text}
          value={text}
          onChangeText={(next) => { setText(next); changeSettings({ instructions: next }); }}
          placeholder="How should it respond? For example: Be brief."
          placeholderTextColor={t.c.tertiary}
          style={[styles.input, { color: t.c.text }]}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 10 },
  card: { borderRadius: 22, borderCurve: 'continuous', padding: 16 },
  input: { fontSize: 17, lineHeight: 23, minHeight: 150, textAlignVertical: 'top', padding: 0 },
});
