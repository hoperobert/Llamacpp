// Wraps wllama (llama.cpp compiled to WebAssembly): model download, loading
// and text generation.

import { Wllama, LoggerWithoutDebug } from '../vendor/wllama/index.js';

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

function create() {
  const wllama = new Wllama(
    { default: asset('vendor/wllama/wasm/wllama.wasm') },
    { logger: LoggerWithoutDebug, allowOffline: true, parallelDownloads: 3 }
  );
  // Safari lacks two WebAssembly features the main build needs, so it gets
  // the compatibility build. Served from this site so it works offline.
  wllama.setCompat({
    worker: asset('vendor/wllama-compat/wllama.js'),
    wasm: asset('vendor/wllama-compat/wllama.wasm'),
  });
  return wllama;
}

export class Engine {
  wllama = null;
  model = null;
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

  async load(model, { nCtx, gpu }, onProgress) {
    await this.unload();
    // Ask the browser not to evict the model when storage runs low.
    try { await navigator.storage?.persist?.(); } catch (e) { /* optional */ }
    const wllama = create();
    try {
      await wllama.loadModelFromUrl(model.url, {
        n_ctx: nCtx,
        ...(gpu ? {} : { n_gpu_layers: 0 }),
        progressCallback: onProgress,
      });
    } catch (e) {
      await wllama.exit().catch(() => {});
      throw e;
    }
    this.wllama = wllama;
    this.model = model;
    this.nCtx = wllama.getLoadedContextInfo?.().n_ctx || nCtx;
    this.threads = wllama.getNumThreads();
  }

  async unload() {
    if (this.wllama) await this.wllama.exit().catch(() => {});
    this.wllama = null;
    this.model = null;
  }

  async deleteModel(model) {
    if (this.model?.url === model.url) await this.unload();
    const models = await (this.wllama || create()).modelManager.getModels({ includeInvalid: true });
    for (const m of models) if (m.url === model.url) await m.remove();
  }

  async deleteAllModels() {
    await this.unload();
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
