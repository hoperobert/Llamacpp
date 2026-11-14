// Stand-in for the browser preview, where SQLite is not set up. It keeps
// everything in memory. The real database is in db.ts.

import type { Chat, ChatMeta, Memory } from './storage';

let memories: Memory[] = [];
const chats = new Map<string, Chat>();

const list = (): ChatMeta[] =>
  [...chats.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, pinned: !!c.pinned }));

export const memoryStore = {
  all: async (): Promise<Memory[]> => memories,
  async add(memory: Memory) { memories = [...memories.filter((m) => m.id !== memory.id), memory]; },
  async remove(id: string) { memories = memories.filter((m) => m.id !== id); },
};

export const chatStore = {
  chatList: async () => list(),
  chat: async (id: string): Promise<Chat | null> => chats.get(id) ?? null,
  async saveChat(chat: Chat) { chats.set(chat.id, chat); return list(); },
  async updateChat(id: string, patch: Partial<Pick<Chat, 'title' | 'titled' | 'pinned'>>) {
    const chat = chats.get(id);
    if (chat) chats.set(id, { ...chat, ...patch });
    return list();
  },
  async deleteChat(id: string) { chats.delete(id); return list(); },
  async deleteAllChats() { chats.clear(); },
  allChats: async () => [...chats.values()],
  async searchChats(query: string): Promise<(ChatMeta & { snippet?: string })[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const found: (ChatMeta & { snippet?: string })[] = [];
    for (const meta of list()) {
      const hit = chats.get(meta.id)?.messages.find((m) => m.content.toLowerCase().includes(q));
      if (meta.title.toLowerCase().includes(q) || hit) {
        found.push({ ...meta, snippet: hit?.content.slice(0, 100).replace(/\s+/g, ' ') });
      }
    }
    return found;
  },
};
