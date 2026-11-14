// Offline support.
//
// Two caches, so an app update does not re-download the large engine files:
//   shell   the small app files. Replaced whenever VERSION changes.
//   engine  the llama.cpp WebAssembly builds (about 29 MB). Kept until
//           ENGINE_VERSION changes.
// Downloaded models are separate again (private file storage) and are never
// touched by updates.

// Bump when any file in SHELL changes.
const VERSION = 'v11';
// Bump only when the files under vendor/ change.
const ENGINE_VERSION = 'wllama-3.13.0';

const SHELL_CACHE = `pocket-llm-shell-${VERSION}`;
const ENGINE_CACHE = `pocket-llm-engine-${ENGINE_VERSION}`;

const SHELL = [
  './',
  'index.html',
  'style.css',
  'js/app.js',
  'js/engine.js',
  'js/store.js',
  'js/markdown.js',
  'js/download-worker.js',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

const ENGINE = [
  'vendor/wllama/index.js',
  'vendor/wllama/wasm/wllama.wasm',
  'vendor/wllama-compat/wllama.js',
  'vendor/wllama-compat/wllama.wasm',
];

const absolute = (path) => new URL(path, self.registration.scope).href;
const isEngine = (url) => ENGINE.some((path) => absolute(path) === url.split('?')[0]);

/**
 * Fills the engine cache, reusing files an earlier version already stored
 * and fetching only what is missing. Failures are left for the next visit
 * (or for the first use, which caches on demand), so a weak connection
 * cannot block an app update.
 */
async function fillEngineCache() {
  const cache = await caches.open(ENGINE_CACHE);
  await Promise.all(ENGINE.map(async (path) => {
    const url = absolute(path);
    if (await cache.match(url)) return;
    try {
      // Versions before v5 kept the engine in the shell cache.
      let response = null;
      for (const name of await caches.keys()) {
        if (name.startsWith('pocket-llm-') && !name.startsWith('pocket-llm-engine-')) {
          response = await (await caches.open(name)).match(url);
          if (response) break;
        }
      }
      response = response || await fetch(new Request(url, { cache: 'reload' }));
      if (response.ok) await cache.put(url, response);
    } catch (error) {
      // Try again later.
    }
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL.map((path) => new Request(path, { cache: 'reload' })));
    await fillEngineCache();
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, ENGINE_CACHE]);
    for (const name of await caches.keys()) {
      if (name.startsWith('pocket-llm-') && !keep.has(name)) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

// These headers make the page "cross-origin isolated", which browsers
// require before they allow multi-threaded WebAssembly. Static hosts such as
// GitHub Pages cannot set them, so the service worker adds them.
function isolate(response) {
  if (!response || response.status === 0) return response;
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Model downloads go to Hugging Face and are stored by the app itself.
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(isEngine(request.url) ? ENGINE_CACHE : SHELL_CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return isolate(cached);
    try {
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return isolate(response);
    } catch (error) {
      if (request.mode === 'navigate') {
        const shell = await cache.match('index.html');
        if (shell) return isolate(shell);
      }
      throw error;
    }
  })());
});
