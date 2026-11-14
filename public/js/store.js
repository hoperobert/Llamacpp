// Small IndexedDB wrapper. Everything the app remembers lives here, on the
// device: chats, memories and settings.

const DB_NAME = 'pocket-llm';
const DB_VERSION = 1;

let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('chats')) db.createObjectStore('chats', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const store = {
  getValue: (key) => run('kv', 'readonly', (s) => s.get(key)),
  setValue: (key, value) => run('kv', 'readwrite', (s) => s.put(value, key)),

  async listChats() {
    const chats = await run('chats', 'readonly', (s) => s.getAll());
    return (chats || []).sort((a, b) => b.updatedAt - a.updatedAt);
  },
  saveChat: (chat) => run('chats', 'readwrite', (s) => s.put(chat)),
  deleteChat: (id) => run('chats', 'readwrite', (s) => s.delete(id)),
  clearChats: () => run('chats', 'readwrite', (s) => s.clear()),
};

export const newId = () =>
  (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
