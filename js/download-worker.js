// Downloads one model file into the browser's private file storage (OPFS).
//
// Unlike a plain fetch, this survives bad connections: it writes straight to
// disk as data arrives, and after any failure it asks the server for only the
// bytes still missing. A half-finished file is kept, so the download can also
// continue after the app is closed or updated.
//
// The finished file is stored where wllama looks for cached models:
//   cache/<key>                 the model
//   cache/__metadata__<key>     written last, marks the file as complete
// Resume state lives in downloads/<key>.json.

const STALL_MS = 30000;        // no data for this long counts as a dropped connection
const MAX_BACKOFF_MS = 30000;
const FLUSH_BYTES = 4 * 1024 * 1024;   // how much could be lost if the app is killed

let cancelled = false;
let controller = null;

let lastDataAt = 0;
let wake = null;   // cuts a retry wait short

const sleep = (ms) => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  wake = () => { clearTimeout(timer); resolve(); };
});
const fatal = (message) => Object.assign(new Error(message), { fatal: true });
// Lines for the diagnostics log.
const note = (text) => postMessage({ type: 'note', text });

async function directory(name) {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(name, { create: true });
}

async function readJson(dir, name) {
  try {
    const file = await (await dir.getFileHandle(name)).getFile();
    return JSON.parse(await file.text());
  } catch (e) {
    return null;
  }
}

async function writeText(dir, name, text) {
  const handle = await (await dir.getFileHandle(name, { create: true })).createSyncAccessHandle();
  try {
    handle.truncate(0);
    handle.write(new TextEncoder().encode(text), { at: 0 });
    handle.flush();
  } finally {
    handle.close();
  }
}

function waitForConnection() {
  return new Promise((resolve) => {
    const done = () => { self.removeEventListener('online', done); resolve(); };
    wake = done;
    self.addEventListener('online', done);
    setTimeout(done, 15000);   // the online event is not fully reliable, so also poll
  });
}

/**
 * One connection attempt. Appends to the file from `offset` and returns the
 * new offset when the response ends, whether or not the file is complete.
 */
async function attempt(url, handle, offset, info, saveInfo) {
  controller = new AbortController();
  let timer;
  const arm = () => {
    lastDataAt = Date.now();
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), STALL_MS);
  };
  const request = (target) => fetch(target, {
    headers: offset > 0 ? { Range: `bytes=${offset}-` } : {},
    signal: controller.signal,
    cache: 'no-store',
  });

  try {
    arm();
    let response = await request(url);

    // The model URL redirects to a download server. Some browsers drop the
    // Range header when following that redirect, which makes the server send
    // the whole file again. If that happened, ask the download server
    // directly: it honours the range.
    if (offset > 0 && response.status === 200 && response.url && response.url !== url) {
      const direct = response.url;
      await response.body?.cancel().catch(() => {});
      arm();
      const retried = await request(direct).catch(() => null);
      if (retried && (retried.status === 206 || retried.status === 200)) {
        response = retried;
      } else {
        await retried?.body?.cancel().catch(() => {});
        arm();
        response = await request(url);
      }
    }
    note(`resume at ${offset}: HTTP ${response.status}`);

    if (response.status === 416) {
      // Asked for bytes past the end, so the saved part is longer than the
      // file. Only then is starting over the right answer.
      handle.truncate(0);
      info.total = 0;
      return 0;
    }
    if ([401, 403, 404, 410].includes(response.status)) {
      throw fatal(`The server refused the download (HTTP ${response.status}).`);
    }
    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status}`);
    }

    const length = parseInt(response.headers.get('content-length') || '0', 10);
    let total = 0;
    // Bytes to throw away before writing. Used when the server insists on
    // sending the file from the start: the saved part is kept and the
    // repeated beginning is skipped, so progress never goes backwards.
    let skip = 0;

    if (response.status === 206) {
      const range = (response.headers.get('content-range') || '').match(/\/(\d+)$/);
      total = range ? parseInt(range[1], 10) : (length ? offset + length : 0);
      if (info.total && total && info.total !== total) {
        // A different size means a different file on the server.
        note(`size changed from ${info.total} to ${total}, starting over`);
        handle.truncate(0);
        info.total = 0;
        await response.body.cancel().catch(() => {});
        return 0;
      }
    } else {
      total = length;
      if (offset > 0) {
        if (info.total && total && info.total !== total) {
          note(`size changed from ${info.total} to ${total}, starting over`);
          handle.truncate(0);
          offset = 0;
        } else {
          note(`range ignored, skipping the first ${offset} bytes`);
          skip = offset;
        }
      }
    }

    if (total && total !== info.total) {
      info.total = total;
      await saveInfo();
    }

    const reader = response.body.getReader();
    let unflushed = 0;
    let lastPost = 0;
    postMessage({ type: 'progress', loaded: offset, total });
    while (true) {
      arm();
      let { done, value } = await reader.read();
      if (done) break;
      if (skip > 0) {
        if (value.byteLength <= skip) {
          skip -= value.byteLength;
          continue;
        }
        value = value.subarray(skip);
        skip = 0;
      }
      handle.write(value, { at: offset });
      offset += value.byteLength;
      unflushed += value.byteLength;
      if (unflushed >= FLUSH_BYTES) {
        handle.flush();
        unflushed = 0;
      }
      const now = Date.now();
      if (now - lastPost > 150) {
        lastPost = now;
        postMessage({ type: 'progress', loaded: offset, total });
      }
    }
    handle.flush();
    if (!total && skip === 0) info.total = offset;   // no size given: the stream ending is the end
    return offset;
  } finally {
    clearTimeout(timer);
    try { handle.flush(); } catch (e) { /* closing anyway */ }
  }
}

async function download({ url, key }) {
  const cache = await directory('cache');
  const state = await directory('downloads');
  const stateName = `${key}.json`;

  const fileHandle = await cache.getFileHandle(key, { create: true });
  let handle;
  try {
    handle = await fileHandle.createSyncAccessHandle();
  } catch (e) {
    throw fatal('This model is already downloading in another tab or window.');
  }

  let info = (await readJson(state, stateName)) || {};
  if (info.url !== url) info = { url, total: 0, etag: '' };
  const saveInfo = () => writeText(state, stateName, JSON.stringify(info));

  try {
    let offset = handle.getSize();
    let failures = 0;
    note(`starting with ${offset} bytes already saved, expected total ${info.total || 'unknown'}`);

    while (!(info.total > 0 && offset === info.total)) {
      if (cancelled) throw new DOMException('Paused', 'AbortError');
      if (info.total > 0 && offset > info.total) {
        handle.truncate(0);
        offset = 0;
      }
      if (!navigator.onLine) {
        postMessage({ type: 'status', state: 'waiting' });
        await waitForConnection();
        continue;
      }

      const before = offset;
      try {
        postMessage({ type: 'status', state: 'downloading' });
        offset = await attempt(url, handle, offset, info, saveInfo);
        if (offset > before) failures = 0;
      } catch (e) {
        if (cancelled) throw new DOMException('Paused', 'AbortError');
        if (e.fatal) throw e;
        offset = handle.getSize();
        failures = offset > before ? 0 : failures + 1;
        const wait = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(failures, 5));
        postMessage({ type: 'status', state: 'retrying', detail: String(e.message || e), wait });
        await sleep(wait);
      }
    }

    // A model file always starts with the letters GGUF. Anything else means
    // we saved an error page or a corrupted file.
    const magic = new Uint8Array(4);
    handle.read(magic, { at: 0 });
    if (String.fromCharCode(...magic) !== 'GGUF') {
      handle.truncate(0);
      await state.removeEntry(stateName).catch(() => {});
      throw fatal('The downloaded file is not a valid model.');
    }
  } finally {
    try { handle.flush(); } catch (e) { /* closing anyway */ }
    handle.close();
  }

  await writeText(cache, `__metadata__${key}`, JSON.stringify({
    originalURL: url,
    originalSize: info.total,
    etag: (info.etag || '').replace(/[^A-Za-z0-9]/g, ''),
  }));
  await state.removeEntry(stateName).catch(() => {});
  postMessage({ type: 'done', total: info.total });
}

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type === 'start') {
    download(message).catch((e) => {
      postMessage({
        type: 'error',
        aborted: e?.name === 'AbortError',
        message: String(e?.message || e),
      });
    });
  } else if (message.type === 'nudge') {
    // The app came back to the foreground. Phones suspend the page in the
    // background, which leaves a dead connection behind, so if nothing has
    // arrived for a moment, drop it and reconnect now instead of waiting.
    if (Date.now() - lastDataAt > 3000) controller?.abort();
    wake?.();
  } else if (message.type === 'cancel') {
    cancelled = true;
    controller?.abort();
  }
};
