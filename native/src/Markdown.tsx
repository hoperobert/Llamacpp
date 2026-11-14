// A small Markdown renderer for replies: paragraphs, headings, lists, quotes,
// code blocks, bold, italic and inline code.

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Palette } from './theme';

type Block =
  | { type: 'p' | 'h' | 'quote'; text: string }
  | { type: 'code'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] };

const FENCE = /^\s*```/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^#{1,4}\s+(.+)$/;
const QUOTE = /^>\s?(.*)$/;

function parse(source: string): Block[] {
  const lines = source.replace(/\r/g, '').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (FENCE.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) code.push(lines[i++]);
      i++;
      blocks.push({ type: 'code', text: code.join('\n') });
    } else if (!line.trim()) {
      i++;
    } else if (HEADING.test(line)) {
      blocks.push({ type: 'h', text: line.match(HEADING)![1] });
      i++;
    } else if (BULLET.test(line) || ORDERED.test(line)) {
      const ordered = ORDERED.test(line);
      const re = ordered ? ORDERED : BULLET;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) items.push(lines[i++].match(re)![1]);
      blocks.push({ type: 'list', ordered, items });
    } else if (QUOTE.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) quote.push(lines[i++].match(QUOTE)![1]);
      blocks.push({ type: 'quote', text: quote.join('\n') });
    } else {
      const para: string[] = [];
      while (
        i < lines.length && lines[i].trim() && !FENCE.test(lines[i]) && !HEADING.test(lines[i]) &&
        !BULLET.test(lines[i]) && !ORDERED.test(lines[i]) && !QUOTE.test(lines[i])
      ) para.push(lines[i++]);
      blocks.push({ type: 'p', text: para.join('\n') });
    }
  }
  return blocks;
}

function Inline({ text, c }: { text: string; c: Palette }) {
  const parts = text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\s][^*\n]*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
          return (
            <Text key={i} style={[styles.inlineCode, { backgroundColor: c.sunken }]}>
              {part.slice(1, -1)}
            </Text>
          );
        }
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          return <Text key={i} style={styles.bold}>{part.slice(2, -2)}</Text>;
        }
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
          return <Text key={i} style={styles.italic}>{part.slice(1, -1)}</Text>;
        }
        return part;
      })}
    </>
  );
}

export function Markdown({ source, c, size }: { source: string; c: Palette; size: number }) {
  const blocks = React.useMemo(() => parse(source), [source]);
  const body = { color: c.text, fontSize: size, lineHeight: size * 1.5 };
  return (
    <View style={styles.gap}>
      {blocks.map((block, i) => {
        if (block.type === 'code') {
          return (
            <ScrollView key={i} horizontal style={[styles.code, { backgroundColor: c.sunken }]}>
              <Text selectable style={[styles.mono, { color: c.text, fontSize: size - 2 }]}>{block.text}</Text>
            </ScrollView>
          );
        }
        if (block.type === 'list') {
          return (
            <View key={i} style={styles.listGap}>
              {block.items.map((item, n) => (
                <View key={n} style={styles.row}>
                  <Text style={[body, styles.marker, { color: c.muted }]}>
                    {block.ordered ? `${n + 1}.` : '•'}
                  </Text>
                  <Text selectable style={[body, styles.flex]}><Inline text={item} c={c} /></Text>
                </View>
              ))}
            </View>
          );
        }
        if (block.type === 'h') {
          return (
            <Text key={i} selectable style={[body, styles.bold, { fontSize: size + 1 }]}>
              <Inline text={block.text} c={c} />
            </Text>
          );
        }
        if (block.type === 'quote') {
          return (
            <View key={i} style={[styles.quote, { borderLeftColor: c.line }]}>
              <Text selectable style={[body, { color: c.muted }]}><Inline text={block.text} c={c} /></Text>
            </View>
          );
        }
        return <Text key={i} selectable style={body}><Inline text={block.text} c={c} /></Text>;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 10 },
  listGap: { gap: 4 },
  row: { flexDirection: 'row' },
  flex: { flex: 1 },
  marker: { width: 24 },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  mono: { fontFamily: 'Menlo' },
  inlineCode: { fontFamily: 'Menlo', fontSize: 14 },
  code: { borderRadius: 12, padding: 12 },
  quote: { borderLeftWidth: 3, paddingLeft: 12 },
});
