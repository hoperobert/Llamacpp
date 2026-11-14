import { Wllama, LoggerWithoutDebug } from './vendor/wllama/index.js';

const MODELS = [
  {
    id: 'qwen35-0.8b',
    name: 'Qwen3.5 0.8B',
    note: 'Fastest. Best choice for most iPhones.',
    sizeMB: 563,
    url: 'https://huggingface.co/ggml-org/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_0.gguf',
  },
  {
    id: 'qwen35-2b',
    name: 'Qwen3.5 2B',
    note: 'Smarter, slower. Needs a recent Pro-class phone.',
    sizeMB: 1281,
    url: 'https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf',
  },
];

// ?model=<url to a .gguf> adds a custom model to the list.
const customUrl = new URLSearchParams(location.search).get('model');
if (customUrl) {
  MODELS.unshift({
    id: 'custom',
    name: decodeURIComponent(customUrl.split('/').pop().split('?')[0]),
    note: 'Custom model from the page address.',
    sizeMB: null,
    url: new URL(customUrl, location.href).href,
  });
}

const SYSTEM_PROMPT = 'You are a helpful assistant. Keep answers short and clear.';
const CONTEXT_TOKENS = 4096;
const SELECTED_KEY = 'pocket-llm-model';

const $ = (id) => document.getElementById(id);
const el = {
  badges: $('badges'), setup: $('setup'), models: $('models'), load: $('load'),
  progress: $('progress'), bar: $('bar'), progressText: $('progressText'),
  error: $('error'), installHint: $('installHint'), storage: $('storage'),
  clear: $('clear'), chat: $('chat'), messages: $('messages'),
  composer: $('composer'), stats: $('stats'), form: $('form'),
  input: $('input'), send: $('send'), reset: $('reset'), change: $('change'),
};

let wllama = null;
let history = [];
let abortController = null;
let cachedUrls = new Set();

// ---------- offline shell ----------

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    // The service worker adds the headers that unlock multi-threading, but
    // only for pages it served. Reload once so this page gets them.
    if (!self.crossOriginIsolated && !sessionStorage.getItem('coi-reloaded')) {
      sessionStorage.setItem('coi-reloaded', '1');
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) => {
          navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
          setTimeout(resolve, 3000);
        });
      }
      if (!wllama) location.reload();
    }
  } catch (e) {
    console.warn('Service worker registration failed', e);
  }
}

// ---------- setup screen ----------

function newWllama() {
  const w = new Wllama(
    { default: './vendor/wllama/wasm/wllama.wasm' },
    { logger: LoggerWithoutDebug, allowOffline: true, parallelDownloads: 3 }
  );
  // Safari lacks two WebAssembly features the main build needs, so it gets
  // the compatibility build. Served from this site so it works offline.
  w.setCompat({
    worker: new URL('./vendor/wllama-compat/wllama.js', location.href).href,
    wasm: new URL('./vendor/wllama-compat/wllama.wasm', location.href).href,
  });
  return w;
}

function renderModels() {
  const selected = localStorageGet(SELECTED_KEY) || MODELS[0].id;
  el.models.querySelectorAll('.model').forEach((n) => n.remove());
  for (const m of MODELS) {
    const label = document.createElement('label');
    label.className = 'model';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'model';
    input.value = m.id;
    input.checked = m.id === selected || (customUrl && m.id === 'custom');
    input.addEventListener('change', updateLoadButton);
    const text = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = m.name;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = (m.sizeMB ? `${formatMB(m.sizeMB)} · ` : '') + m.note;
    text.append(name, meta);
    label.append(input, text);
    if (cachedUrls.has(m.url)) {
      const saved = document.createElement('span');
      saved.className = 'saved';
      saved.textContent = 'On device';
      label.append(saved);
    }
    el.models.append(label);
  }
  if (!el.models.querySelector('input:checked')) {
    el.models.querySelector('input').checked = true;
  }
  updateLoadButton();
}

function selectedModel() {
  const id = el.models.querySelector('input:checked')?.value;
  return MODELS.find((m) => m.id === id) || MODELS[0];
}

function updateLoadButton() {
  const m = selectedModel();
  el.load.textContent = cachedUrls.has(m.url) ? 'Start' : 'Download and start';
}

async function refreshCacheState() {
  try {
    const probe = wllama || newWllama();
    const models = await probe.modelManager.getModels();
    cachedUrls = new Set(models.map((m) => m.url));
  } catch (e) {
    cachedUrls = new Set();
  }
  el.clear.hidden = cachedUrls.size === 0;
  renderModels();
  try {
    const { usage, quota } = await navigator.storage.estimate();
    if (quota) {
      el.storage.textContent =
        `Storage used: ${formatMB(usage / 1e6)} of ${formatMB(quota / 1e6)} available to this app.`;
    }
  } catch (e) { /* estimate is optional */ }
}

function renderBadges(extra = []) {
  const items = [];
  items.push(navigator.gpu ? { text: 'WebGPU', good: true } : { text: 'CPU only' });
  if (!navigator.onLine) items.push({ text: 'Offline' });
  items.push(...extra);
  el.badges.replaceChildren(...items.map((b) => {
    const span = document.createElement('span');
    span.className = 'badge' + (b.good ? ' good' : '');
    span.textContent = b.text;
    return span;
  }));
}

function showError(message) {
  el.error.textContent = message;
  el.error.hidden = !message;
}

async function loadSelectedModel() {
  const m = selectedModel();
  localStorageSet(SELECTED_KEY, m.id);
  showError('');
  el.load.disabled = true;
  el.progress.hidden = false;
  setProgress(0, cachedUrls.has(m.url) ? 'Loading…' : 'Starting download…');

  // Ask the browser not to evict the model when storage runs low.
  try { await navigator.storage?.persist?.(); } catch (e) { /* optional */ }

  try {
    if (wllama) await wllama.exit().catch(() => {});
    wllama = newWllama();
    await wllama.loadModelFromUrl(m.url, {
      n_ctx: CONTEXT_TOKENS,
      progressCallback: ({ loaded, total }) => {
        const pct = total ? loaded / total : 0;
        if (loaded >= total) {
          setProgress(1, 'Loading into memory…');
        } else {
          setProgress(pct, `Downloading ${formatMB(loaded / 1e6)} of ${formatMB(total / 1e6)}`);
        }
      },
    });
  } catch (e) {
    console.error(e);
    wllama = null;
    el.load.disabled = false;
    el.progress.hidden = true;
    showError(explainLoadError(e, m));
    refreshCacheState();
    return;
  }

  el.load.disabled = false;
  el.progress.hidden = true;
  const threads = wllama.getNumThreads();
  renderBadges([{ text: `${threads} thread${threads === 1 ? '' : 's'}` }]);
  history = [];
  el.messages.replaceChildren();
  el.stats.textContent = `${m.name} ready.`;
  el.setup.hidden = true;
  el.chat.hidden = false;
  el.composer.hidden = false;
  el.input.focus();
  refreshCacheState();
}

function explainLoadError(e, m) {
  const text = String(e?.message || e);
  if (!navigator.onLine && !cachedUrls.has(m.url)) {
    return 'You are offline and this model is not on the device yet. Connect once to download it.';
  }
  if (/quota|storage|space/i.test(text)) {
    return 'Not enough storage for this model. Free some space or pick the smaller one.';
  }
  if (/memory|alloc|OOM/i.test(text)) {
    return 'This model is too big for the memory this browser allows. Try the smaller one.';
  }
  return `Could not load the model: ${text}`;
}

function setProgress(fraction, text) {
  el.bar.style.width = `${Math.round(fraction * 100)}%`;
  el.progressText.textContent = text;
}

// ---------- chat ----------

function addMessage(role, text = '') {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = text;
  el.messages.append(div);
  scrollToEnd();
  return div;
}

function scrollToEnd() {
  const main = document.querySelector('main');
  main.scrollTop = main.scrollHeight;
}

async function sendMessage(text) {
  history.push({ role: 'user', content: text });
  addMessage('user', text);
  const bubble = addMessage('assistant');
  const think = document.createElement('span');
  think.className = 'think';
  const answer = document.createElement('span');

  abortController = new AbortController();
  el.send.textContent = 'Stop';
  el.stats.textContent = 'Thinking…';

  let reply = '';
  let thinking = '';
  let tokens = 0;
  let firstTokenAt = 0;
  let timings = null;
  const startedAt = performance.now();

  try {
    const stream = await wllama.createChatCompletion({
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history],
      stream: true,
      max_tokens: 1024,
      temperature: 0.7,
      cache_prompt: true,
      timings_per_token: true,
      chat_template_kwargs: { enable_thinking: false },
      abortSignal: abortController.signal,
    });
    for await (const chunk of stream) {
      if (chunk.timings) timings = chunk.timings;
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.reasoning_content) {
        thinking += delta.reasoning_content;
        think.textContent = thinking;
        if (!think.isConnected) bubble.append(think);
      }
      if (delta.content) {
        reply += delta.content;
        answer.textContent = reply;
        if (!answer.isConnected) bubble.append(answer);
      }
      if (delta.content || delta.reasoning_content) {
        tokens++;
        if (!firstTokenAt) firstTokenAt = performance.now();
        const seconds = (performance.now() - firstTokenAt) / 1000;
        if (tokens > 3 && seconds > 0) {
          el.stats.textContent = `${((tokens - 1) / seconds).toFixed(1)} tokens/s`;
        }
        scrollToEnd();
      }
    }
  } catch (e) {
    if (e?.name !== 'AbortError') {
      console.error(e);
      const err = document.createElement('span');
      err.className = 'error';
      err.textContent = (reply ? '\n' : '') + `Stopped: ${e?.message || e}`;
      bubble.append(err);
    }
  }

  if (reply) history.push({ role: 'assistant', content: reply });
  else history.pop();
  if (!reply && !bubble.textContent) bubble.remove();

  el.stats.textContent = formatStats({ tokens, firstTokenAt, startedAt, timings });
  el.send.textContent = 'Send';
  abortController = null;
}

function formatStats({ tokens, firstTokenAt, startedAt, timings }) {
  if (!tokens) return '';
  let speed;
  let count = tokens;
  if (timings?.predicted_per_second) {
    speed = timings.predicted_per_second;
    count = timings.predicted_n || tokens;
  } else {
    const seconds = (performance.now() - firstTokenAt) / 1000;
    speed = seconds > 0 ? (tokens - 1) / seconds : 0;
  }
  const wait = ((firstTokenAt - startedAt) / 1000).toFixed(1);
  return `${speed.toFixed(1)} tokens/s · ${count} tokens · ${wait}s to first word`;
}

function autoGrow() {
  el.input.style.height = 'auto';
  el.input.style.height = `${el.input.scrollHeight}px`;
}

// ---------- helpers ----------

function formatMB(mb) {
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}
function localStorageGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function localStorageSet(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* private mode */ }
}

// ---------- events ----------

el.load.addEventListener('click', loadSelectedModel);

el.clear.addEventListener('click', async () => {
  if (!confirm('Delete all downloaded models from this device?')) return;
  try {
    if (wllama) await wllama.exit().catch(() => {});
    wllama = null;
    await newWllama().cacheManager.clear();
  } catch (e) {
    showError(`Could not delete: ${e?.message || e}`);
  }
  refreshCacheState();
});

el.form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (abortController) {
    abortController.abort();
    return;
  }
  const text = el.input.value.trim();
  if (!text || !wllama) return;
  el.input.value = '';
  autoGrow();
  sendMessage(text);
});

el.input.addEventListener('input', autoGrow);
el.input.addEventListener('keydown', (event) => {
  const touch = matchMedia('(pointer: coarse)').matches;
  if (event.key === 'Enter' && !event.shiftKey && !touch && !event.isComposing) {
    event.preventDefault();
    el.form.requestSubmit();
  }
});

el.reset.addEventListener('click', () => {
  abortController?.abort();
  history = [];
  el.messages.replaceChildren();
  el.stats.textContent = '';
});

el.change.addEventListener('click', async () => {
  abortController?.abort();
  if (wllama) await wllama.exit().catch(() => {});
  wllama = null;
  el.chat.hidden = true;
  el.composer.hidden = true;
  el.setup.hidden = false;
  renderBadges();
  refreshCacheState();
});

addEventListener('online', () => renderBadges());
addEventListener('offline', () => renderBadges());

// ---------- start ----------

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = navigator.standalone === true ||
  matchMedia('(display-mode: standalone)').matches;
el.installHint.hidden = !(isIOS && !isStandalone);

renderBadges();
renderModels();
refreshCacheState();
registerServiceWorker();
