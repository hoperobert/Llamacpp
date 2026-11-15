// A small Markdown renderer for replies: paragraphs, headings, lists, quotes,
// tables, rules, code blocks with a copy button, and inline bold, italic,
// strikethrough, code and links.

import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { copyText, runCode } from '../lib/app';
import { runnable } from '../lib/runner';
import { Icon } from './Icon';
import type { Theme } from './theme';

type Block =
  | { type: 'p' | 'quote'; text: string }
  | { type: 'h'; text: string; level: number }
  | { type: 'code'; text: string; lang: string; closed: boolean }
  | { type: 'list'; ordered: boolean; start: number; items: { text: string; depth: number }[] }
  | { type: 'table'; head: string[]; rows: string[][] }
  | { type: 'rule' };

const FENCE = /^\s*```\s*([\w+#.-]*)/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED = /^(\s*)(\d+)[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*$/;
const QUOTE = /^>\s?(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const cells = (line: string) =>
  line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());

const isListLine = (line: string) => BULLET.test(line) || ORDERED.test(line);

function parse(source: string): Block[] {
  const lines = source.replace(/\r/g, '').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(FENCE);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]);
      // Still being written if its closing line has not arrived.
      const closed = i < lines.length;
      i++;
      blocks.push({ type: 'code', text: code.join('\n'), lang: fence[1], closed });
    } else if (!line.trim()) {
      i++;
    } else if (HEADING.test(line)) {
      const [, hashes, text] = line.match(HEADING)!;
      blocks.push({ type: 'h', text, level: hashes.length });
      i++;
    } else if (RULE.test(line)) {
      blocks.push({ type: 'rule' });
      i++;
    } else if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i])) rows.push(cells(lines[i++]));
      blocks.push({ type: 'table', head, rows });
    } else if (isListLine(line)) {
      const ordered = ORDERED.test(line);
      const start = ordered ? Number(line.match(ORDERED)![2]) : 1;
      const items: { text: string; depth: number }[] = [];
      while (i < lines.length && (isListLine(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        const bullet = lines[i].match(BULLET);
        const number = lines[i].match(ORDERED);
        if (bullet) items.push({ text: bullet[2], depth: Math.min(3, Math.floor(bullet[1].length / 2)) });
        else if (number) items.push({ text: number[3], depth: Math.min(3, Math.floor(number[1].length / 2)) });
        else items[items.length - 1].text += `\n${lines[i].trim()}`;
        i++;
      }
      blocks.push({ type: 'list', ordered, start, items });
    } else if (QUOTE.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) quote.push(lines[i++].match(QUOTE)![1]);
      blocks.push({ type: 'quote', text: quote.join('\n') });
    } else {
      const para: string[] = [];
      while (
        i < lines.length && lines[i].trim() && !FENCE.test(lines[i]) && !HEADING.test(lines[i]) &&
        !isListLine(lines[i]) && !QUOTE.test(lines[i]) && !RULE.test(lines[i])
      ) para.push(lines[i++]);
      blocks.push({ type: 'p', text: para.join('\n') });
    }
  }
  return blocks;
}

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\s][^*\n]*\*|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s<>)\]]+)/g;

function Inline({ text, t }: { text: string; t: Theme }) {
  const parts = text.split(INLINE);
  return (
    <>
      {parts.map((part, i) => {
        if (!part) return null;
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
          return (
            <Text key={i} style={[styles.inlineCode, { backgroundColor: t.c.fill, fontSize: t.size - 2 }]}>
              {part.slice(1, -1)}
            </Text>
          );
        }
        if ((part.startsWith('**') || part.startsWith('__')) && part.length > 4 && part.endsWith(part.slice(0, 2))) {
          return <Text key={i} style={styles.bold}>{part.slice(2, -2)}</Text>;
        }
        if (part.startsWith('~~') && part.endsWith('~~') && part.length > 4) {
          return <Text key={i} style={styles.strike}>{part.slice(2, -2)}</Text>;
        }
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
          return <Text key={i} style={styles.italic}>{part.slice(1, -1)}</Text>;
        }
        const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
        const url = link ? link[2] : /^https?:\/\//.test(part) ? part : null;
        if (url) {
          return (
            <Text key={i} style={styles.link} onPress={() => Linking.openURL(url).catch(() => {})}>
              {link ? link[1] : part}
            </Text>
          );
        }
        return part;
      })}
    </>
  );
}

function CodeBlock({ block, t }: { block: Extract<Block, { type: 'code' }>; t: Theme }) {
  const kind = block.closed ? runnable(block.lang, block.text) : null;
  return (
    <View style={[styles.code, { backgroundColor: t.c.fill }]}>
      <View style={styles.codeHead}>
        <Text style={[styles.codeLang, styles.flex, { color: t.c.secondary }]}>{block.lang || 'code'}</Text>
        {!!kind && (
          <Pressable
            onPress={() => runCode(block.lang, block.text)}
            hitSlop={10}
            accessibilityLabel={kind === 'page' ? 'Preview page' : 'Run code'}
            style={({ pressed }) => [styles.codeCopy, pressed && styles.dim]}
          >
            <Icon name="play.fill" size={12} color={t.c.accent} />
            <Text style={[styles.codeLang, styles.bold, { color: t.c.accent }]}>
              {kind === 'page' ? 'Preview' : 'Run'}
            </Text>
          </Pressable>
        )}
        <Pressable
          onPress={() => copyText(block.text)}
          hitSlop={10}
          accessibilityLabel="Copy code"
          style={({ pressed }) => [styles.codeCopy, pressed && styles.dim]}
        >
          <Icon name="doc.on.doc" size={14} color={t.c.secondary} />
          <Text style={[styles.codeLang, { color: t.c.secondary }]}>Copy</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.codeBody}>
        <Text selectable style={[styles.mono, { color: t.c.text, fontSize: t.size - 3, lineHeight: (t.size - 3) * 1.45 }]}>
          {block.text}
        </Text>
      </ScrollView>
    </View>
  );
}

function Table({ block, t }: { block: Extract<Block, { type: 'table' }>; t: Theme }) {
  const body = { color: t.c.text, fontSize: t.size - 2, lineHeight: (t.size - 2) * 1.4 };
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={[styles.table, { borderColor: t.c.line }]}>
        {[block.head, ...block.rows].map((row, r) => (
          <View
            key={r}
            style={[
              styles.tableRow,
              r > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.c.line },
              r === 0 && { backgroundColor: t.c.fill },
            ]}
          >
            {block.head.map((_, col) => (
              <Text key={col} selectable style={[body, styles.cell, r === 0 && styles.bold]}>
                <Inline text={row[col] ?? ''} t={t} />
              </Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

export const Markdown = React.memo(function Markdown({ source, t }: { source: string; t: Theme }) {
  const blocks = React.useMemo(() => parse(source), [source]);
  const body = { color: t.c.text, fontSize: t.size, lineHeight: t.size * 1.45 };
  return (
    <View style={styles.gap}>
      {blocks.map((block, i) => {
        if (block.type === 'code') return <CodeBlock key={i} block={block} t={t} />;
        if (block.type === 'table') return <Table key={i} block={block} t={t} />;
        if (block.type === 'rule') {
          return <View key={i} style={[styles.rule, { backgroundColor: t.c.line }]} />;
        }
        if (block.type === 'list') {
          let n = block.start - 1;
          return (
            <View key={i} style={styles.listGap}>
              {block.items.map((item, index) => {
                if (item.depth === 0) n++;
                return (
                  <View key={index} style={[styles.row, { paddingLeft: item.depth * 18 }]}>
                    <Text style={[body, styles.marker, { color: t.c.secondary }]}>
                      {block.ordered && item.depth === 0 ? `${n}.` : '•'}
                    </Text>
                    <Text selectable style={[body, styles.flex]}><Inline text={item.text} t={t} /></Text>
                  </View>
                );
              })}
            </View>
          );
        }
        if (block.type === 'h') {
          const size = t.size + (block.level === 1 ? 5 : block.level === 2 ? 3 : 1);
          return (
            <Text key={i} selectable style={[body, styles.heading, { fontSize: size, lineHeight: size * 1.3 }]}>
              <Inline text={block.text} t={t} />
            </Text>
          );
        }
        if (block.type === 'quote') {
          return (
            <View key={i} style={[styles.quote, { borderLeftColor: t.c.line }]}>
              <Text selectable style={[body, { color: t.c.secondary }]}><Inline text={block.text} t={t} /></Text>
            </View>
          );
        }
        return <Text key={i} selectable style={body}><Inline text={block.text} t={t} /></Text>;
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  gap: { gap: 12 },
  listGap: { gap: 6 },
  row: { flexDirection: 'row' },
  flex: { flex: 1 },
  marker: { width: 24 },
  bold: { fontWeight: '600' },
  heading: { fontWeight: '700', marginTop: 4 },
  italic: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  link: { textDecorationLine: 'underline' },
  mono: { fontFamily: 'Menlo' },
  inlineCode: { fontFamily: 'Menlo' },
  code: { borderRadius: 16, borderCurve: 'continuous', overflow: 'hidden' },
  codeHead: {
    flexDirection: 'row', alignItems: 'center', gap: 18,
    paddingHorizontal: 14, paddingTop: 10,
  },
  codeLang: { fontSize: 13 },
  codeCopy: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  codeBody: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 14 },
  dim: { opacity: 0.5 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
  quote: { borderLeftWidth: 3, paddingLeft: 12 },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, borderCurve: 'continuous', overflow: 'hidden' },
  tableRow: { flexDirection: 'row' },
  cell: { width: 132, paddingHorizontal: 10, paddingVertical: 8 },
});
