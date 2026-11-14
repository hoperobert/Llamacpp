export const data = new Map();
export default {
  async getItem(key) { return data.has(key) ? data.get(key) : null; },
  async setItem(key, value) { data.set(key, value); },
  async removeItem(key) { data.delete(key); },
  async multiRemove(keys) { keys.forEach((k) => data.delete(k)); },
};
