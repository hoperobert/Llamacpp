// Everything the app remembers, stored on the device.

import AsyncStorage from '@react-native-async-storage/async-storage';

export type Message = {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  speed?: number;
  error?: string;
};

export type Chat = {
  id: string;
  title: string;
  messages: Message[];
  summary: string;
  /** Messages before this index are no longer sent to the model. */
  cut: number;
  /** Measured context use after the last reply. */
  ctx: { used: number; cut: number; count: number } | null;
  updatedAt: number;
};

export type ChatMeta = Pick<Chat, 'id' | 'title' | 'updatedAt'>;
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
  theme: 'auto' | 'light' | 'dark';
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
  theme: 'auto',
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

export const store = {
  async settings(): Promise<Settings> {
    return { ...DEFAULT_SETTINGS, ...(await read<Partial<Settings>>('settings', {})) };
  },
  saveSettings: (settings: Settings) => write('settings', settings),

  memories: () => read<Memory[]>('memories', []),
  saveMemories: (memories: Memory[]) => write('memories', memories),

  chatList: () => read<ChatMeta[]>('chats', []),
  chat: (id: string) => read<Chat | null>(`chat:${id}`, null),

  async saveChat(chat: Chat): Promise<ChatMeta[]> {
    await write(`chat:${chat.id}`, chat);
    const list = (await store.chatList()).filter((c) => c.id !== chat.id);
    list.unshift({ id: chat.id, title: chat.title, updatedAt: chat.updatedAt });
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

  /** Marker written while a model is loading; still present at start means the load crashed the app. */
  loadMarker: () => read<{ modelId: string; nCtx: number } | null>('loading', null),
  setLoadMarker: (value: { modelId: string; nCtx: number } | null) =>
    value ? write('loading', value) : AsyncStorage.removeItem('loading').catch(() => {}),
};

export const blankChat = (): Chat => ({
  id: newId(), title: 'New chat', messages: [], summary: '', cut: 0, ctx: null, updatedAt: Date.now(),
});
