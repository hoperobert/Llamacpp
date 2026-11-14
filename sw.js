// Offline support. Bump VERSION whenever any file in SHELL changes, so
// installed copies pick up the new files.
const VERSION = 'v1';
const CACHE = `pocket-llm-${VERSION}`;

const SHELL = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'vendor/wllama/index.js',
  'vendor/wllama/wasm/wllama.wasm',
  'vendor/wllama-compat/wllama.js',
  'vendor/wllama-compat/wllama.wasm',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('pocket-llm-') && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
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
  // Model downloads go to Hugging Face. wllama stores those itself.
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
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
