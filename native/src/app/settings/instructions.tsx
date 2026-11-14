import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { app, changeSettings } from '../../lib/app';
import { useTheme } from '../../ui/theme';

const EXAMPLES = ['Be brief.', 'Use British English.', 'Explain things as if I am new to them.'];

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
          placeholder="How should it respond?"
          placeholderTextColor={t.c.tertiary}
          style={[styles.input, { color: t.c.text }]}
        />
      </View>
      <Text style={[styles.footer, { color: t.c.secondary }]}>
        These are given to the model at the start of every chat. For example:{'\n'}
        {EXAMPLES.map((e) => `•  ${e}`).join('\n')}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 10 },
  card: { borderRadius: 22, borderCurve: 'continuous', padding: 16 },
  input: { fontSize: 17, lineHeight: 23, minHeight: 150, textAlignVertical: 'top', padding: 0 },
  footer: { fontSize: 13, lineHeight: 19, marginHorizontal: 16 },
});
