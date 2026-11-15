// Running the code a model writes, on the phone.
//
// The code runs in a web view of its own: a blank page with no address, no
// way into the app or its files, and no internet. JavaScript runs there and
// what it prints comes back as lines. A web page is simply shown.
//
// Nothing here touches the phone, so the tests use it as it is.

/** A script is run for what it prints. A page is run to be looked at. Python is a script that needs its runtime. */
export type Runnable = 'script' | 'page' | 'python';

export type Line = {
  kind: 'log' | 'warn' | 'error' | 'result' | 'blocked' | 'done' | 'ready' | 'store' | 'ask';
  text: string;
};

const SCRIPTS = ['js', 'javascript', 'mjs', 'cjs', 'node', 'nodejs'];
const PAGES = ['html', 'htm', 'xhtml', 'svg'];
const PYTHON = ['python', 'py', 'python3'];

/** Whether a code block can be run here, and how. */
export function runnable(lang: string, code: string): Runnable | null {
  if (!code.trim()) return null;
  const named = lang.toLowerCase();
  if (SCRIPTS.includes(named)) return 'script';
  if (PAGES.includes(named)) return 'page';
  if (PYTHON.includes(named)) return 'python';
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
  // What the code keeps (localStorage) is held by the app, so a saved tool finds it again next time.
  var data = window.__pocketData || {};
  var keep = function (key, value) { post('store', JSON.stringify({ key: key, value: value })); };
  var has = function (key) { return Object.prototype.hasOwnProperty.call(data, key); };
  var storage = {
    getItem: function (key) { key = String(key); return has(key) ? data[key] : null; },
    setItem: function (key, value) { data[String(key)] = String(value); keep(String(key), String(value)); },
    removeItem: function (key) { delete data[String(key)]; keep(String(key), null); },
    clear: function () { Object.keys(data).forEach(function (key) { keep(key, null); }); data = {}; },
    key: function (index) { var keys = Object.keys(data); return index < keys.length ? keys[index] : null; }
  };
  Object.defineProperty(storage, 'length', { get: function () { return Object.keys(data).length; } });
  try { Object.defineProperty(window, 'localStorage', { value: storage, configurable: true }); } catch (e) {}
  // Asking the phone for something: where it is, its battery, its torch.
  var waiting = {};
  var asked = 0;
  var phone = function (what, arg) {
    return new Promise(function (resolve) {
      asked += 1;
      waiting[asked] = resolve;
      post('ask', JSON.stringify({ id: asked, what: String(what), arg: arg === undefined ? null : arg }));
    });
  };
  var answer = function (id, value) {
    var resolve = waiting[id];
    delete waiting[id];
    if (resolve) resolve(value);
  };
  window.addEventListener('message', function (event) {
    try {
      var said = JSON.parse(event.data);
      if (said && said.answer) answer(said.answer.id, said.answer.value);
    } catch (e) {}
  });
  window.pocket = { post: post, show: show, phone: phone, answer: answer };
})();
</script>`;

/** Code as text that is safe to write inside a script on a page. */
const quoted = (code: string) =>
  JSON.stringify(code)
    .replace(/</g, '\\u003c')
    // Two rare characters that JSON allows but older script parsers read as the end of a line.
    .split(String.fromCharCode(0x2028)).join('\\u2028')
    .split(String.fromCharCode(0x2029)).join('\\u2029');

/**
 * What someone asking for a tool is given along with their request, so that
 * what comes back is something this app can run and keep.
 */
export const TOOL_BRIEF =
  'Build this as a small tool that runs on a phone with no internet. Reply with one complete HTML page in a single ' +
  '```html block: its CSS and JavaScript inside it, nothing loaded from anywhere else, big buttons and text, and a ' +
  'layout for a narrow screen. It can keep data between uses with localStorage. It can also ask the phone: ' +
  "`await pocket.phone('location')` gives {latitude, longitude}, `await pocket.phone('battery')` gives a number from 0 to 1, " +
  "`pocket.phone('torch', 1)` and `pocket.phone('torch', 0)` turn the torch on and off, and `pocket.phone('speak', text)` says something aloud. " +
  'After the code, say in one or two lines how to use it.';

/** The page the web view is given: the code, wrapped so that it runs and reports back. */
export function runnerPage(kind: Runnable, code: string, data: Record<string, string> = {}): string {
  const kept = Object.keys(data).length ? `<script>window.__pocketData = JSON.parse(${quoted(JSON.stringify(data))});</script>` : '';
  const head = NO_INTERNET + PHONE_SIZED + kept + BRIDGE;
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

/**
 * Python's runtime (Pyodide: Python built to run inside a web view), downloaded
 * once and kept on the phone. After that Python runs with no internet.
 */
export const PYTHON_VERSION = '314.0.8';
export const PYTHON_FILES = [
  { name: 'pyodide.mjs', bytes: 17758 },
  { name: 'pyodide.asm.mjs', bytes: 1250259 },
  { name: 'pyodide.asm.wasm', bytes: 9597892 },
  { name: 'python_stdlib.zip', bytes: 2545550 },
  { name: 'pyodide-lock.json', bytes: 119077 },
];
export const PYTHON_MB = Math.round(PYTHON_FILES.reduce((n, f) => n + f.bytes, 0) / 1e6);
export const pythonUrl = (name: string) => `https://cdn.jsdelivr.net/npm/pyodide@${PYTHON_VERSION}/${name}`;

/**
 * The page that runs Python. It sits in the same folder as the runtime, and is
 * given the code once it says it is ready. It may fetch from its own folder
 * and nowhere else.
 */
export function pythonPage(): string {
  const rules =
    '<meta http-equiv="Content-Security-Policy" content="' +
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; connect-src 'self'; " +
    "style-src 'unsafe-inline'; img-src data: blob:\">";
  return `<!doctype html><html><head><meta charset="utf-8">${rules}${PHONE_SIZED}${BRIDGE}</head><body><script type="module">
import { loadPyodide } from './pyodide.mjs';
// Only the part of Python's account of an error that is about the user's own code.
const told = (error) => {
  const lines = String(error && error.message || error).trim().split('\\n');
  const own = lines.findIndex((line) => line.includes('"<exec>"'));
  const kept = own >= 0 ? lines.slice(own) : lines.slice(-6);
  // What follows a missing module is advice about fetching it, which there is no internet in here to do.
  const missing = kept.findIndex((line) => line.startsWith('ModuleNotFoundError'));
  return (missing >= 0 ? kept.slice(0, missing + 1) : kept).join('\\n').replace(/File "<exec>", /g, '');
};
window.pocketRun = async (code) => {
  try {
    const python = await loadPyodide({
      indexURL: './',
      stdout: (text) => pocket.post('log', text),
      stderr: (text) => pocket.post('warn', text),
    });
    const result = await python.runPythonAsync(code);
    if (result !== undefined && result !== null) pocket.post('result', String(result));
  } catch (error) {
    const text = told(error);
    pocket.post('error', /ModuleNotFoundError/.test(text)
      ? text + '\\n(Only what comes with Python itself is on the phone, not packages like numpy.)'
      : text);
  }
  pocket.post('done', '');
};
window.addEventListener('message', (event) => {
  try {
    const asked = JSON.parse(event.data);
    if (asked && typeof asked.run === 'string') window.pocketRun(asked.run);
  } catch (e) {}
});
pocket.post('ready', '');
</script></body></html>`;
}

/** What a run printed, as plain text. Only the end of a very long output is kept. */
export function outputText(lines: Line[], maxChars = 2000): string {
  const text = lines
    .filter((line) => line.kind === 'log' || line.kind === 'warn' || line.kind === 'error' || line.kind === 'result' || line.kind === 'blocked')
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
