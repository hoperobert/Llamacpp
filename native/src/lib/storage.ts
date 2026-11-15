// The shapes of what the app remembers, and the small preferences kept in
// key-value storage. Chats and memories are in the database (db.ts).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { chatStore, projectStore } from './db';
import type { Model } from './models';
import type { Session } from './session';

export type Message = {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  /** A photo sent with the message: a name inside the app's storage. */
  image?: string;
  /** Passages from the offline library that were given to the model with this message. */
  context?: string;
  /** The titles of what was looked up, to show under the message. */
  sources?: string[];
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
  /** The project this chat belongs to, if any. */
  projectId?: string;
  /** An incognito chat is never saved, named or used for memories. */
  incognito?: boolean;
  /** What the user said this chat is for (/goal). The model is reminded of it in every reply. */
  goal?: string;
  messages: Message[];
  summary: string;
  /** Messages before this index are no longer sent to the model. */
  cut: number;
  /** Measured context use after the last reply. */
  ctx: { used: number; cut: number; count: number } | null;
  updatedAt: number;
};

export type ChatMeta = Pick<Chat, 'id' | 'title' | 'updatedAt' | 'pinned' | 'projectId'>;
export type Memory = { id: string; text: string };

/** A group of chats that share instructions. */
export type Project = { id: string; name: string; instructions: string };

export const STYLES = [
  { id: 'normal', label: 'Normal', prompt: '' },
  { id: 'concise', label: 'Concise', prompt: 'Be brief. Answer in as few words as the question allows.' },
  {
    id: 'explanatory', label: 'Explain',
    prompt: 'Explain step by step, as a patient teacher would, with an example where it helps.',
  },
  { id: 'formal', label: 'Formal', prompt: 'Write formally and precisely, as in a professional document.' },
] as const;

export type StyleId = (typeof STYLES)[number]['id'];

export type Settings = {
  modelId: string | null;
  instructions: string;
  style: StyleId;
  temperature: number;
  maxTokens: number;
  nCtx: number;
  /** True when the context size is chosen for each model to fit this phone. nCtx then holds what was chosen. */
  autoContext: boolean;
  thinking: boolean;
  /** Look things up in the offline library before answering. */
  lookup: boolean;
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
  style: 'normal',
  temperature: 0.7,
  maxTokens: 768,
  nCtx: 4096,
  autoContext: true,
  thinking: false,
  lookup: false,
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

  // Chats, their messages and projects are in the database (db.ts).
  ...chatStore,
  ...projectStore,

  /** The chat that was on screen when the app was last left, and when. */
  lastOpen: () => read<{ chatId: string; at: number } | null>('lastOpen', null),
  setLastOpen: (value: { chatId: string; at: number } | null) =>
    value ? write('lastOpen', value) : AsyncStorage.removeItem('lastOpen').catch(() => {}),

  /** The last error nothing caught, for the bottom of Settings. */
  lastError: () => read<{ at: number; text: string } | null>('lastError', null),
  setLastError: (value: { at: number; text: string }) => write('lastError', value),

  /** What the app was doing, for working out afterwards why it closed. See session.ts. */
  session: () => read<Session | null>('session', null),
  setSession: (value: Session) => write('session', value),

  /** Marker written while a model is loading; still present at start means the load crashed the app. */
  loadMarker: () => read<{ modelId: string; nCtx: number } | null>('loading', null),
  setLoadMarker: (value: { modelId: string; nCtx: number } | null) =>
    value ? write('loading', value) : AsyncStorage.removeItem('loading').catch(() => {}),
};

export const blankChat = (options: { projectId?: string; incognito?: boolean } = {}): Chat => ({
  id: newId(), title: 'New chat', messages: [], summary: '', cut: 0, ctx: null, updatedAt: Date.now(),
  ...options,
});

/** A chat written out as Markdown, for sharing. */
export function chatAsMarkdown(chat: Chat): string {
  const lines = [`# ${chat.title}`, ''];
  for (const m of chat.messages) {
    lines.push(m.role === 'user' ? '**You**' : '**Assistant**', '', m.content.trim(), '');
  }
  return lines.join('\n').trim();
}
