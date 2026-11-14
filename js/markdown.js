// A small, safe Markdown renderer. All input is HTML-escaped before any tags
// are added, so model output can never inject markup.

const escapeHtml = (s) => s
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function inline(text) {
  let s = escapeHtml(text);
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_, code) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = s
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*\n]*)\*(?![*\w])/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\s][^_\n]*)_(?![_\w])/g, '$1<em>$2</em>')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

const RE = {
  fence: /^\s*```\s*([\w+-]*)\s*$/,
  heading: /^(#{1,4})\s+(.+)$/,
  bullet: /^\s*[-*+]\s+(.*)$/,
  ordered: /^\s*\d+[.)]\s+(.*)$/,
  quote: /^>\s?(.*)$/,
  rule: /^\s*([-*_])\1{2,}\s*$/,
  tableRow: /^\s*\|(.+)\|\s*$/,
  tableDivider: /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/,
};

const startsBlock = (line) =>
  RE.fence.test(line) || RE.heading.test(line) || RE.bullet.test(line) ||
  RE.ordered.test(line) || RE.quote.test(line) || RE.rule.test(line);

const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function renderMarkdown(source) {
  const lines = String(source).replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (RE.fence.test(line)) {
      const code = [];
      i++;
      while (i < lines.length && !RE.fence.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    if (!line.trim()) { i++; continue; }

    const heading = line.match(RE.heading);
    if (heading) {
      const level = Math.min(heading[1].length + 2, 5);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }
    if (RE.rule.test(line)) { out.push('<hr>'); i++; continue; }

    if (RE.tableRow.test(line) && i + 1 < lines.length && RE.tableDivider.test(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && RE.tableRow.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(
        '<div class="table"><table><thead><tr>' +
        head.map((c) => `<th>${inline(c)}</th>`).join('') +
        '</tr></thead><tbody>' +
        rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('') +
        '</tbody></table></div>'
      );
      continue;
    }

    if (RE.bullet.test(line) || RE.ordered.test(line)) {
      const ordered = RE.ordered.test(line);
      const re = ordered ? RE.ordered : RE.bullet;
      const items = [];
      while (i < lines.length) {
        const match = lines[i].match(re);
        if (match) {
          items.push(match[1]);
        } else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) {
          items[items.length - 1] += ' ' + lines[i].trim();
        } else {
          break;
        }
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${tag}>`);
      continue;
    }

    if (RE.quote.test(line)) {
      const quote = [];
      while (i < lines.length && RE.quote.test(lines[i])) quote.push(lines[i++].match(RE.quote)[1]);
      out.push(`<blockquote>${quote.map(inline).join('<br>')}</blockquote>`);
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) para.push(lines[i++]);
    out.push(`<p>${para.map(inline).join('<br>')}</p>`);
  }

  return out.join('');
}
