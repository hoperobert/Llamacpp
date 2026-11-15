// Running the code a model writes, on the phone.
//
// The code runs in a web view of its own: a blank page with no address, no
// way into the app or its files, and no internet. JavaScript runs there and
// what it prints comes back as lines. A web page is simply shown.
//
// Nothing here touches the phone, so the tests use it as it is.

/** A script is run for what it prints. A page is run to be looked at. */
export type Runnable = 'script' | 'page';

export type Line = {
  kind: 'log' | 'warn' | 'error' | 'result' | 'blocked' | 'done';
  text: string;
};

const SCRIPTS = ['js', 'javascript', 'mjs', 'cjs', 'node', 'nodejs'];
const PAGES = ['html', 'htm', 'xhtml', 'svg'];

/** Whether a code block can be run here, and how. */
export function runnable(lang: string, code: string): Runnable | null {
  if (!code.trim()) return null;
  const named = lang.toLowerCase();
  if (SCRIPTS.includes(named)) return 'script';
  if (PAGES.includes(named)) return 'page';
  // A block with no language named that is plainly a web page.
  if (!named && /^\s*(<!doctype html|<html[\s>]|<svg[\s>])/i.test(code)) return 'page';
  return null;
}

// Nothing may be fetched: no scripts, pictures, fonts or requests from the
// internet. Only what is written in the code itself.
const NO_INTERNET =
  '<meta http-equiv="Content-Security-Policy" content="' +
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; " +
  'img-src data: blob:; media-src data: blob:; font-src data:">';

const PHONE_SIZED = '<meta name="viewport" content="width=device-width, initial-scale=1">';

// Sends what the code prints, and what goes wrong, back to the app.
const BRIDGE = `<script>
(function () {
  var post = function (kind, text) {
    var message = JSON.stringify({ kind: kind, text: String(text) });
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(message);
    else if (window.parent !== window) window.parent.postMessage(message, '*');
  };
  var show = function (value) {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.name + ': ' + value.message;
    if (typeof value === 'function') return '[function ' + (value.name || 'anonymous') + ']';
    try {
      var plain = function (key, v) { return typeof v === 'bigint' ? v + 'n' : v; };
      var text = JSON.stringify(value, plain);
      if (text === undefined) return String(value);
      // Short things on one line, as a console shows them. Long ones laid out.
      return text.length <= 72 ? text : JSON.stringify(value, plain, 2);
    } catch (e) {
      return String(value);
    }
  };
  var kinds = { log: 'log', info: 'log', debug: 'log', warn: 'warn', error: 'error' };
  Object.keys(kinds).forEach(function (name) {
    console[name] = function () {
      post(kinds[name], Array.prototype.map.call(arguments, show).join(' '));
    };
  });
  console.table = console.log;
  window.onerror = function (message, source, line) {
    post('error', String(message) + (line ? ' (line ' + line + ')' : ''));
    return true;
  };
  window.addEventListener('unhandledrejection', function (event) { post('error', show(event.reason)); });
  document.addEventListener('securitypolicyviolation', function (event) {
    post('blocked', event.blockedURI || 'something from the internet');
  });
  window.pocket = { post: post, show: show };
})();
</script>`;

/** Code as text that is safe to write inside a script on a page. */
const quoted = (code: string) =>
  JSON.stringify(code)
    .replace(/</g, '\\u003c')
    // Two rare characters that JSON allows but older script parsers read as the end of a line.
    .split(String.fromCharCode(0x2028)).join('\\u2028')
    .split(String.fromCharCode(0x2029)).join('\\u2029');

/** The page the web view is given: the code, wrapped so that it runs and reports back. */
export function runnerPage(kind: Runnable, code: string): string {
  const head = NO_INTERNET + PHONE_SIZED + BRIDGE;
  if (kind === 'script') {
    // Run as the body of an async function, so that "await" works at the top
    // and a mistake in the code is caught like any other error.
    return `<!doctype html><html><head><meta charset="utf-8">${head}</head><body><script>
(async function () {
  try {
    var AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    var result = await new AsyncFunction(${quoted(code)})();
    if (result !== undefined) pocket.post('result', pocket.show(result));
  } catch (e) {
    pocket.post('error', pocket.show(e));
  }
  pocket.post('done', '');
})();
</script></body></html>`;
  }
  if (/^\s*<svg[\s>]/i.test(code)) {
    return `<!doctype html><html><head><meta charset="utf-8">${head}</head>` +
      `<body style="margin:0;min-height:100vh;display:grid;place-items:center">${code}</body></html>`;
  }
  // A page of the model's own: the same rules go in ahead of everything in it.
  const doctype = code.match(/^\s*<!doctype[^>]*>/i);
  return doctype
    ? doctype[0] + head + code.slice(doctype[0].length)
    : `<!doctype html>${head}${code}`;
}

/** What a run printed, as plain text. Only the end of a very long output is kept. */
export function outputText(lines: Line[], maxChars = 2000): string {
  const text = lines
    .filter((line) => line.kind !== 'done')
    .map((line) => (line.kind === 'blocked' ? `Blocked: ${line.text}` : line.text))
    .join('\n')
    .trim();
  return text.length > maxChars ? `…${text.slice(-maxChars)}` : text;
}

export const failed = (lines: Line[]) => lines.some((line) => line.kind === 'error');

/** What to tell the model about a run, so that it can fix the code or carry on. */
export function reportFor(lines: Line[]): string {
  const output = outputText(lines);
  if (!output) return 'I ran the code. It printed nothing.';
  const fence = '```';
  return failed(lines)
    ? `I ran the code and it went wrong. Fix it.\n\n${fence}\n${output}\n${fence}`
    : `I ran the code. It printed:\n\n${fence}\n${output}\n${fence}`;
}
