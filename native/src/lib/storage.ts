// Everything the app remembers, stored on the device.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Model } from './models';

export type Message = {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  /** Seconds spent thinking before the answer started. */
  thought?: number;
  speed?: number;
  /** Set when the reply was cut short, with the reason to show. */
  stopped?: string;
};

export type Chat = {
  id: string;
  title: string;
  /** True once the title was written by the model or the user, not cut from the first message. */
  titled?: boolean;
  pinned?: boolean;
  messages: Message[];
  summary: string;
  /** Messages before this index are no longer sent to the model. */
  cut: number;
  /** Measured context use after the last reply. */
  ctx: { used: number; cut: number; count: number } | null;
  updatedAt: number;
};

export type ChatMeta = Pick<Chat, 'id' | 'title' | 'updatedAt' | 'pinned'>;
export type Memory = { id: string; text: string };

export type Settings = {
  modelId: string | null;
  instructions: string;
  temperature: number;
  maxTokens: number;
  nCtx: number;
  thinking: boolean;
  memoryOn: boolean;
  autoMemory: boolean;
  autoSummary: boolean;
  autoTitle: boolean;
  theme: 'auto' | 'light' | 'dark';
  textSize: 'small' | 'medium' | 'large';
  haptics: boolean;
  /** Ask before a large download on mobile data. */
  cellularWarning: boolean;
  /** True once a model has loaded successfully, so it is safe to auto-load. */
  loadedOnce: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  modelId: null,
  instructions: '',
  temperature: 0.7,
  maxTokens: 768,
  nCtx: 4096,
  thinking: false,
  memoryOn: true,
  autoMemory: true,
  autoSummary: true,
  autoTitle: true,
  theme: 'auto',
  textSize: 'medium',
  haptics: true,
  cellularWarning: true,
  loadedOnce: false,
};

async function read<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

const write = (key: string, value: unknown) =>
  AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {});

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const meta = (chat: Chat): ChatMeta => ({
  id: chat.id, title: chat.title, updatedAt: chat.updatedAt, pinned: chat.pinned,
});

export const store = {
  async settings(): Promise<Settings> {
    return { ...DEFAULT_SETTINGS, ...(await read<Partial<Settings>>('settings', {})) };
  },
  saveSettings: (settings: Settings) => write('settings', settings),

  customModels: () => read<Model[]>('customModels', []),
  saveCustomModels: (models: Model[]) => write('customModels', models),

  /** Downloads the user paused on purpose, so they are not resumed for them. */
  pausedDownloads: () => read<string[]>('pausedDownloads', []),
  savePausedDownloads: (ids: string[]) => write('pausedDownloads', ids),

  chatList: () => read<ChatMeta[]>('chats', []),
  chat: (id: string) => read<Chat | null>(`chat:${id}`, null),

  async saveChat(chat: Chat): Promise<ChatMeta[]> {
    await write(`chat:${chat.id}`, chat);
    const list = (await store.chatList()).filter((c) => c.id !== chat.id);
    list.unshift(meta(chat));
    await write('chats', list);
    return list;
  },

  /** Changes a chat's title or pin without moving it to the top of the list. */
  async updateChat(id: string, patch: Partial<Pick<Chat, 'title' | 'titled' | 'pinned'>>): Promise<ChatMeta[]> {
    const chat = await store.chat(id);
    if (chat) await write(`chat:${id}`, { ...chat, ...patch });
    const list = (await store.chatList()).map((c) => (c.id === id ? { ...c, ...patch } : c));
    await write('chats', list);
    return list;
  },

  async deleteChat(id: string): Promise<ChatMeta[]> {
    await AsyncStorage.removeItem(`chat:${id}`).catch(() => {});
    const list = (await store.chatList()).filter((c) => c.id !== id);
    await write('chats', list);
    return list;
  },

  async deleteAllChats() {
    const list = await store.chatList();
    await AsyncStorage.multiRemove(list.map((c) => `chat:${c.id}`)).catch(() => {});
    await write('chats', []);
  },

  async allChats(): Promise<Chat[]> {
    const list = await store.chatList();
    const chats = await Promise.all(list.map((c) => store.chat(c.id)));
    return chats.filter((c): c is Chat => c !== null);
  },

  /** Marker written while a model is loading; still present at start means the load crashed the app. */
  loadMarker: () => read<{ modelId: string; nCtx: number } | null>('loading', null),
  setLoadMarker: (value: { modelId: string; nCtx: number } | null) =>
    value ? write('loading', value) : AsyncStorage.removeItem('loading').catch(() => {}),
};

export const blankChat = (): Chat => ({
  id: newId(), title: 'New chat', messages: [], summary: '', cut: 0, ctx: null, updatedAt: Date.now(),
});

/** A chat written out as Markdown, for sharing. */
export function chatAsMarkdown(chat: Chat): string {
  const lines = [`# ${chat.title}`, ''];
  for (const m of chat.messages) {
    lines.push(m.role === 'user' ? '**You**' : '**Assistant**', '', m.content.trim(), '');
  }
  return lines.join('\n').trim();
}
