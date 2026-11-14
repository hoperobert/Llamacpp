// Stand-in for the browser preview, where SQLite is not set up. It keeps
// everything in memory. The real database is in db.ts.

import type { Chat, ChatMeta, Memory, Project } from './storage';

let memories: Memory[] = [];
const chats = new Map<string, Chat>();
let projects: Project[] = [];

const list = (): ChatMeta[] =>
  [...chats.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, pinned: !!c.pinned, projectId: c.projectId }));

export const memoryStore = {
  all: async (): Promise<Memory[]> => memories,
  async add(memory: Memory) { memories = [...memories.filter((m) => m.id !== memory.id), memory]; },
  async remove(id: string) { memories = memories.filter((m) => m.id !== id); },
};

export const chatStore = {
  chatList: async () => list(),
  chat: async (id: string): Promise<Chat | null> => chats.get(id) ?? null,
  async saveChat(chat: Chat) { chats.set(chat.id, chat); return list(); },
  async updateChat(id: string, patch: Partial<Pick<Chat, 'title' | 'titled' | 'pinned'>> & { projectId?: string | null }) {
    const chat = chats.get(id);
    if (chat) {
      const { projectId, ...rest } = patch;
      chats.set(id, { ...chat, ...rest, ...(projectId !== undefined ? { projectId: projectId ?? undefined } : {}) });
    }
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

export const projectStore = {
  projects: async (): Promise<Project[]> => projects,
  async saveProject(project: Project) { projects = [project, ...projects.filter((p) => p.id !== project.id)]; },
  async deleteProject(id: string) {
    projects = projects.filter((p) => p.id !== id);
    for (const [key, chat] of chats) if (chat.projectId === id) chats.set(key, { ...chat, projectId: undefined });
    return list();
  },
};
