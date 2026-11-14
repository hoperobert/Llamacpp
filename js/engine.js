// Wraps wllama (llama.cpp compiled to WebAssembly): model download, loading
// and text generation.

import { Wllama } from '../vendor/wllama/index.js';

export const MODELS = [
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

const asset = (path) => new URL(path, document.baseURI).href;

export const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// ---------- diagnostics log ----------

const LOG_LIMIT = 400;
const logLines = [];
let lastActivity = performance.now();

// ---------- crash detection ----------
//
// Loading a model can exhaust the browser's memory, which kills the page
// outright with no error to catch. So a marker is written while a load is in
// flight; finding it at the next start means the last load took the page down.

const CRASH_KEY = 'pocket-llm-loading';
const LOG_KEY = 'pocket-llm-last-log';

const storage = {
  get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* private mode */ } },
  remove(key) { try { localStorage.removeItem(key); } catch (e) { /* private mode */ } },
};

/** The load that was in flight when the page last died: { gpu, single, nCtx }, or null. */
export const previousCrash = (() => {
  try {
    const value = JSON.parse(storage.get(CRASH_KEY));
    storage.remove(CRASH_KEY);
    return value;
  } catch (e) {
    return null;
  }
})();
const previousLog = previousCrash ? storage.get(LOG_KEY) || '' : '';

// Closing the app mid-load is not a crash.
addEventListener('pagehide', () => storage.remove(CRASH_KEY));

export const modeKey = (mode) => `${mode.gpu ? 'gpu' : 'cpu'}-${mode.single ? 'single' : 'multi'}`;

let loadInFlight = false;
let lastLogSave = 0;

function record(level, args) {
  lastActivity = performance.now();
  // Keep the tail of the log on disk during a load, so it survives a crash.
  if (loadInFlight && performance.now() - lastLogSave > 400) {
    lastLogSave = performance.now();
    queueMicrotask(() => storage.set(LOG_KEY, logLines.slice(-80).join('\n')));
  }
  const text = args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack || ''}` : String(a))).join(' ');
  logLines.push(`${(performance.now() / 1000).toFixed(1)}s ${level} ${text.slice(0, 500)}`);
  if (logLines.length > LOG_LIMIT) logLines.shift();
}

const logger = {
  debug: (...args) => record('D', args),
  log: (...args) => record('I', args),
  warn: (...args) => { record('W', args); console.warn(...args); },
  error: (...args) => { record('E', args); console.error(...args); },
};

/** A plain-text report for troubleshooting a device that will not load. */
export function diagnostics() {
  return [
    `Pocket LLM diagnostics, ${new Date().toISOString()}`,
    `Engine: ${Engine.version()}`,
    `Browser: ${navigator.userAgent}`,
    `Installed: ${navigator.standalone === true || matchMedia('(display-mode: standalone)').matches}`,
    `Isolated: ${self.crossOriginIsolated} | WebGPU: ${!!navigator.gpu} | Cores: ${navigator.hardwareConcurrency}` +
      ` | Memory hint: ${navigator.deviceMemory ?? 'n/a'} GB | Online: ${navigator.onLine}`,
    '',
    ...logLines,
    ...(previousCrash
      ? ['', `--- Previous session crashed while loading (${modeKey(previousCrash)}, context ${previousCrash.nCtx}) ---`, previousLog]
      : []),
  ].join('\n');
}

function create() {
  const wllama = new Wllama(
    { default: asset('vendor/wllama/wasm/wllama.wasm') },
    { logger, allowOffline: true, parallelDownloads: 3 }
  );
  // Safari lacks two WebAssembly features the main build needs, so it gets
  // the compatibility build. Served from this site so it works offline.
  wllama.setCompat({
    worker: asset('vendor/wllama-compat/wllama.js'),
    wasm: asset('vendor/wllama-compat/wllama.wasm'),
  });
  return wllama;
}

// ---------- model files on disk ----------

/** The file name wllama uses for a cached URL: sha1(url) + "_" + file name. */
async function fileKey(url) {
  const hash = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(url));
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex}_${url.split('/').pop()}`;
}

async function opfsDir(name) {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(name, { create: true });
}

// Models split into several files use wllama's own downloader.
const isSplit = (url) => /-\d{5}-of-\d{5}\.gguf/.test(url);

// A load that shows no sign of life for this long is treated as hung.
const STALL_MS = 45000;

const modeLabel = (mode) =>
  `${mode.gpu ? 'GPU' : 'CPU'}, ${mode.single ? 'one thread' : 'multi-thread'}`;

/**
 * Ways to load a model, most capable first. Some devices hang or crash on
 * the faster ones (iOS in particular), so load() works down the list.
 */
function loadModes(wantGpu, preferred, bad = []) {
  const modes = [];
  const gpu = wantGpu && !!navigator.gpu;
  if (gpu && !isIOS) modes.push({ gpu: true, single: false });
  if (gpu) modes.push({ gpu: true, single: true });
  if (!isIOS) modes.push({ gpu: false, single: false });
  modes.push({ gpu: false, single: true });
  if (preferred) {
    const i = modes.findIndex((m) => m.gpu === preferred.gpu && m.single === preferred.single);
    if (i > 0) modes.unshift(...modes.splice(i, 1));
  }
  // Skip modes that crashed the page before. If every mode has, keep the
  // lightest one so the user can still try (for example with less context).
  const usable = modes.filter((m) => !bad.includes(modeKey(m)));
  return usable.length ? usable : modes.slice(-1);
}

export class Engine {
  wllama = null;
  model = null;
  mode = null;
  downloadWorker = null;
  nCtx = 0;
  threads = 0;

  static version() {
    try { return Wllama.getLibllamaVersion(); } catch (e) { return 'unknown'; }
  }

  get ready() { return !!this.wllama && !!this.model; }

  /** URLs of the models already stored on this device. */
  async cachedUrls() {
    try {
      const models = await (this.wllama || create()).modelManager.getModels();
      return new Set(models.map((m) => m.url));
    } catch (e) {
      return new Set();
    }
  }

  /**
   * Downloads the model if needed, then loads it, falling back to safer
   * modes if one fails or hangs. `onProgress` gets { phase, fraction, mode }.
   * Resolves with the mode that worked.
   */
  async load(model, { nCtx, gpu, loadMode, badModes }, onProgress) {
    await this.unload();
    // Ask the browser not to evict the model when storage runs low.
    try { await navigator.storage?.persist?.(); } catch (e) { /* optional */ }

    record('I', [`Loading ${model.name}, context ${nCtx}`]);
    const manager = create().modelManager;
    const find = async () => (await manager.getModels()).find((m) => m.url === model.url);
    let stored = await find();
    if (!stored && isSplit(model.url)) {
      stored = await manager.downloadModel({ url: model.url }, {
        progressCallback: ({ loaded, total }) =>
          onProgress({ phase: 'download', fraction: total ? loaded / total : 0, loaded, total }),
      });
    } else if (!stored) {
      await this.#download(model, onProgress);
      stored = await find();
      if (!stored) throw new Error('The download finished but the file could not be opened.');
    }

    const modes = loadModes(gpu, loadMode, badModes);
    let lastError = null;
    for (let i = 0; i < modes.length; i++) {
      const mode = modes[i];
      record('I', [`Attempt ${i + 1} of ${modes.length}: ${modeLabel(mode)}`]);
      try {
        await this.#loadWith(stored, mode, nCtx, (fraction) =>
          onProgress({ phase: 'load', fraction, mode, attempt: i + 1 }));
        this.model = model;
        this.mode = mode;
        this.nCtx = this.wllama.getLoadedContextInfo?.().n_ctx || nCtx;
        this.threads = this.wllama.getNumThreads();
        record('I', [`Loaded with ${modeLabel(mode)}, ${this.threads} thread(s)`]);
        return mode;
      } catch (e) {
        lastError = e;
        record('E', [`Attempt failed (${modeLabel(mode)}):`, e]);
      }
    }
    throw lastError;
  }

  /**
   * Downloads a model with automatic retry and resume (see download-worker.js).
   * Rejects with an AbortError when paused through pauseDownload().
   */
  #download(model, onProgress) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./download-worker.js', import.meta.url));
      this.downloadWorker = worker;
      const finish = (fn, value) => {
        worker.terminate();
        if (this.downloadWorker === worker) this.downloadWorker = null;
        fn(value);
      };
      let last = { loaded: 0, total: (model.sizeMB || 0) * 1e6 };
      worker.onmessage = ({ data }) => {
        if (data.type === 'progress') {
          last = { loaded: data.loaded, total: data.total || last.total };
          onProgress({
            phase: 'download', state: 'downloading', ...last,
            fraction: last.total ? last.loaded / last.total : 0,
          });
        } else if (data.type === 'note') {
          record('I', [`Download: ${data.text}`]);
        } else if (data.type === 'status') {
          if (data.state !== 'downloading') record('W', [`Download ${data.state}: ${data.detail || ''}`]);
          onProgress({
            phase: 'download', state: data.state, ...last,
            fraction: last.total ? last.loaded / last.total : 0,
          });
        } else if (data.type === 'done') {
          record('I', ['Download complete']);
          finish(resolve);
        } else if (data.type === 'error') {
          record(data.aborted ? 'I' : 'E', [`Download stopped: ${data.message}`]);
          finish(reject, data.aborted
            ? new DOMException('Download paused', 'AbortError')
            : new Error(data.message));
        }
      };
      worker.onerror = (event) => finish(reject, new Error(event.message || 'Download worker failed'));
      fileKey(model.url).then((key) => worker.postMessage({ type: 'start', url: model.url, key }));
    });
  }

  /** Call when the app returns to the foreground: reconnects a stalled download at once. */
  nudgeDownload() {
    this.downloadWorker?.postMessage({ type: 'nudge' });
  }

  /** Stops a running download but keeps what has arrived, so it can resume. */
  pauseDownload() {
    this.downloadWorker?.postMessage({ type: 'cancel' });
  }

  /** Progress of an unfinished download, or null. `total` is 0 if unknown. */
  async partial(model) {
    try {
      const key = await fileKey(model.url);
      const cache = await opfsDir('cache');
      const file = await (await cache.getFileHandle(key)).getFile();
      const done = await cache.getFileHandle(`__metadata__${key}`).then(() => true, () => false);
      if (done || !file.size) return null;
      let total = 0;
      try {
        const info = await (await (await opfsDir('downloads')).getFileHandle(`${key}.json`)).getFile();
        total = JSON.parse(await info.text()).total || 0;
      } catch (e) { /* no resume record */ }
      return { loaded: file.size, total: total || (model.sizeMB || 0) * 1e6 };
    } catch (e) {
      return null;
    }
  }

  async #loadWith(stored, mode, nCtx, onFraction) {
    const wllama = create();
    const blobs = await stored.open();
    const total = blobs.reduce((n, b) => n + b.size, 0) || 1;
    let read = 0;
    // The engine reads the file in slices. Watching them gives real load
    // progress and shows the load is still alive.
    const watched = blobs.map((blob) => {
      const slice = blob.slice;
      blob.slice = function (start = 0, end = blob.size, ...rest) {
        lastActivity = performance.now();
        read += Math.max(0, Math.min(end, blob.size) - start);
        onFraction(Math.min(0.99, read / total));
        return slice.call(this, start, end, ...rest);
      };
      return blob;
    });

    lastActivity = performance.now();
    loadInFlight = true;
    storage.set(CRASH_KEY, JSON.stringify({ ...mode, nCtx, at: Date.now() }));
    let watchdog;
    const stalled = new Promise((_, reject) => {
      watchdog = setInterval(() => {
        if (performance.now() - lastActivity > STALL_MS) {
          reject(new Error(`No progress for ${STALL_MS / 1000} seconds`));
        }
      }, 2000);
    });
    try {
      await Promise.race([
        wllama.loadModel(watched, {
          n_ctx: nCtx,
          ...(mode.gpu ? {} : { n_gpu_layers: 0 }),
          ...(mode.single ? { n_threads: 1 } : {}),
          // A smaller batch needs smaller working buffers. Phones have little to spare.
          ...(isIOS ? { n_batch: 512 } : {}),
        }),
        stalled,
      ]);
      this.wllama = wllama;
    } catch (e) {
      await wllama.exit().catch(() => {});
      throw e;
    } finally {
      clearInterval(watchdog);
      loadInFlight = false;
      storage.remove(CRASH_KEY);
    }
  }

  async unload() {
    if (this.wllama) await this.wllama.exit().catch(() => {});
    this.wllama = null;
    this.model = null;
  }

  /** Removes a model from the device, including any unfinished download. */
  async deleteModel(model) {
    if (this.model?.url === model.url) await this.unload();
    this.pauseDownload();
    const models = await create().modelManager.getModels({ includeInvalid: true });
    for (const m of models) if (m.url === model.url) await m.remove().catch(() => {});
    const key = await fileKey(model.url);
    const cache = await opfsDir('cache');
    await cache.removeEntry(key).catch(() => {});
    await cache.removeEntry(`__metadata__${key}`).catch(() => {});
    await (await opfsDir('downloads')).removeEntry(`${key}.json`).catch(() => {});
  }

  async deleteAllModels() {
    await this.unload();
    this.pauseDownload();
    const root = await navigator.storage.getDirectory();
    await root.removeEntry('downloads', { recursive: true }).catch(() => {});
    await create().cacheManager.clear();
  }

  /**
   * Streams a reply. Yields { content, reasoning } text deltas, then a final
   * { timings } object with token counts and speed.
   */
  async *chat(messages, { temperature, maxTokens, thinking, signal }) {
    const stream = await this.wllama.createChatCompletion({
      messages,
      stream: true,
      max_tokens: maxTokens,
      temperature,
      cache_prompt: true,
      timings_per_token: true,
      chat_template_kwargs: { enable_thinking: !!thinking },
      abortSignal: signal,
    });
    let timings = null;
    for await (const chunk of stream) {
      if (chunk.timings) timings = chunk.timings;
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content || delta?.reasoning_content) {
        yield { content: delta.content || '', reasoning: delta.reasoning_content || '' };
      }
    }
    yield { timings };
  }

  /** One-shot, non-streamed completion for background jobs (summaries, memory). */
  async complete(messages, { maxTokens = 200, schema = null, signal } = {}) {
    const response = await this.wllama.createChatCompletion({
      messages,
      max_tokens: maxTokens,
      temperature: 0,
      chat_template_kwargs: { enable_thinking: false },
      abortSignal: signal,
      ...(schema
        ? { response_format: { type: 'json_schema', json_schema: { name: 'result', schema, strict: true } } }
        : {}),
    });
    return response.choices?.[0]?.message?.content || '';
  }
}
