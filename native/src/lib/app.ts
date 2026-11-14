// The app's state and everything it can do. Screens read from `app` and call
// the functions below; nothing in here draws anything.

import { Alert, AppState, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Network from 'expo-network';
import * as Speech from 'expo-speech';

import { freeDiskMB, ramMB } from './device';
import {
  deleteModel, isDownloaded, modelUri, pauseDownload, restoreDownloads, startDownload,
  type DownloadState,
} from './downloads';
import * as engine from './engine';
import {
  addMemory, compact, ensureRoom, extractFacts, promptMessages, replyBudget, suggestTitle, usedTokens,
} from './logic';
import { memoryStore } from './db';
import { fit, formatMB, modelFromUrl, MODELS, type Model } from './models';
import {
  blankChat, chatAsMarkdown, DEFAULT_SETTINGS, newId, store,
  type Chat, type ChatMeta, type Memory, type Message, type Settings,
} from './storage';
import { createStore } from './store';

export type EngineState = {
  status: 'none' | 'loading' | 'ready';
  modelId: string | null;
  fraction: number;
  error: string | null;
  gpu: boolean;
};

type State = {
  /** False until saved data has been read at launch. */
  hydrated: boolean;
  settings: Settings;
  memories: Memory[];
  chatList: ChatMeta[];
  chat: Chat;
  engine: EngineState;
  downloaded: Record<string, boolean>;
  downloads: Record<string, DownloadState>;
  customModels: Model[];
  busy: boolean;
  status: string;
  /** The reply being written right now. */
  live: Message | null;
  /** Text waiting in the message box. */
  draft: string;
  /** A message typed while a reply was being written, to send when it finishes. */
  queued: string;
  crashed: boolean;
  toast: string;
  speakingId: string | null;
};

const NO_ENGINE: EngineState = { status: 'none', modelId: null, fraction: 0, error: null, gpu: false };

export const app = createStore<State>({
  hydrated: false,
  settings: DEFAULT_SETTINGS,
  memories: [],
  chatList: [],
  chat: blankChat(),
  engine: NO_ENGINE,
  downloaded: {},
  downloads: {},
  customModels: [],
  busy: false,
  status: '',
  live: null,
  draft: '',
  queued: '',
  crashed: false,
  toast: '',
  speakingId: null,
});

export const allModels = () => [...MODELS, ...app.get().customModels];
export const findModel = (id: string | null) => allModels().find((m) => m.id === id) ?? null;

// ---------- small helpers ----------

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function toast(text: string) {
  app.set({ toast: text });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => app.set({ toast: '' }), 2600);
}

export function haptic(kind: 'tap' | 'select' | 'success' | 'warning' = 'tap') {
  if (!app.get().settings.haptics) return;
  const run =
    kind === 'select' ? Haptics.selectionAsync()
    : kind === 'success' ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    : kind === 'warning' ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
    : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  run.catch(() => {});
}

/** The engine does one thing at a time. Everything that uses it waits its turn here. */
let queue: Promise<unknown> = Promise.resolve();
function withEngine<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job);
  queue = next.catch(() => {});
  return next;
}

function updateSettings(patch: Partial<Settings>): Settings {
  const next = { ...app.get().settings, ...patch };
  app.set({ settings: next });
  store.saveSettings(next);
  return next;
}

/** Updates the list on screen and writes only what changed to the database. */
function saveMemories(next: Memory[]) {
  const before = app.get().memories;
  app.set({ memories: next });
  const kept = new Set(next.map((m) => m.id));
  const had = new Set(before.map((m) => m.id));
  for (const m of before) if (!kept.has(m.id)) memoryStore.remove(m.id).catch(() => {});
  for (const m of next) if (!had.has(m.id)) memoryStore.add(m).catch(() => {});
}

async function saveChat(next: Chat): Promise<Chat> {
  const stamped = { ...next, updatedAt: Date.now() };
  // Only replace what is on screen if that chat is still the open one.
  if (app.get().chat.id === stamped.id) app.set({ chat: stamped });
  if (stamped.messages.length) {
    const chatList = await store.saveChat(stamped);
    app.set({ chatList });
  }
  return stamped;
}

// ---------- launch ----------

let started = false;

export async function start() {
  if (started) return;
  started = true;

  const [savedSettings, memories, chatList, marker, customModels] = await Promise.all([
    store.settings(), memoryStore.all(), store.chatList(), store.loadMarker(), store.customModels(),
  ]);
  let settings = savedSettings;
  // A marker left behind means the last load took the app down, most likely
  // by running out of memory. Do not auto-load into that again.
  if (marker) {
    await store.setLoadMarker(null);
    if (settings.nCtx > 2048) settings = { ...settings, nCtx: 2048 };
    store.saveSettings(settings);
  }
  app.set({ settings, memories, chatList, customModels, crashed: !!marker });

  const models = allModels();
  const flags = await Promise.all(models.map((m) => isDownloaded(m)));
  const downloaded: Record<string, boolean> = {};
  models.forEach((m, i) => { if (flags[i]) downloaded[m.id] = true; });
  app.set({ downloaded, hydrated: true });

  await restoreDownloads(models, (modelId, state, done) => {
    app.set((s) => {
      const downloads = { ...s.downloads };
      if (state) downloads[modelId] = state;
      else delete downloads[modelId];
      return done
        ? { downloads, downloaded: { ...s.downloaded, [modelId]: true } }
        : { downloads };
    });
    if (done) {
      const model = findModel(modelId);
      toast(`${model?.name ?? 'Model'} is ready`);
      haptic('success');
      // The first model someone downloads is the one they want to talk to.
      if (model && app.get().engine.status === 'none' && !app.get().settings.loadedOnce) loadModel(model);
    }
  });

  const preferred = findModel(settings.modelId);
  if (preferred && downloaded[preferred.id] && settings.loadedOnce && !marker) loadModel(preferred);

  AppState.addEventListener('change', onAppState);
  AppState.addEventListener('memoryWarning', onMemoryWarning);
}

// ---------- staying well-behaved in the background ----------

/** Set when iOS asked for memory back and the model was let go to oblige. */
let reloadOnReturn: Model | null = null;

function onAppState(next: string) {
  if (next === 'background') {
    // iOS does not let an app use the GPU in the background. Stop cleanly and
    // keep what was written, instead of being stopped mid-word.
    if (app.get().busy) {
      interrupted = 'Paused when you left the app.';
      engine.stop();
    }
    Speech.stop().catch(() => {});
  } else if (next === 'active' && reloadOnReturn) {
    const model = reloadOnReturn;
    reloadOnReturn = null;
    if (app.get().engine.status === 'none') loadModel(model);
  }
}

function onMemoryWarning() {
  const { engine: state, busy } = app.get();
  if (AppState.currentState === 'active' || busy || state.status !== 'ready') return;
  // Give the memory back while nobody is looking, so iOS does not close the
  // whole app. The model is loaded again when the app is next opened.
  reloadOnReturn = findModel(state.modelId);
  withEngine(async () => {
    await engine.unloadModel();
    app.set({ engine: NO_ENGINE });
  });
}

// ---------- models ----------

export async function loadModel(model: Model, nCtx = app.get().settings.nCtx) {
  app.set({ engine: { status: 'loading', modelId: model.id, fraction: 0, error: null, gpu: false } });
  await withEngine(async () => {
    await store.setLoadMarker({ modelId: model.id, nCtx });
    await activateKeepAwakeAsync('load').catch(() => {});
    try {
      let last = 0;
      const { gpu } = await engine.loadModel(modelUri(model), nCtx, (fraction) => {
        // The engine reports progress far more often than the eye needs.
        if (fraction - last < 0.02 && fraction < 1) return;
        last = fraction;
        app.set((s) => (s.engine.status === 'loading' ? { engine: { ...s.engine, fraction } } : {}));
      });
      app.set({ engine: { status: 'ready', modelId: model.id, fraction: 1, error: null, gpu }, crashed: false });
      updateSettings({ modelId: model.id, loadedOnce: true });
      haptic('success');
    } catch (e) {
      app.set({
        engine: {
          ...NO_ENGINE, modelId: model.id,
          error: `Could not load this model. ${String((e as Error)?.message ?? e)}`,
        },
      });
      haptic('warning');
    }
    await store.setLoadMarker(null);
    deactivateKeepAwake('load').catch(() => {});
  });
}

/** Loads a model, warning first if it is unlikely to fit in memory. */
export function switchModel(model: Model) {
  if (app.get().engine.status === 'loading') return;
  if (fit(model, ramMB) === 'no') {
    Alert.alert(
      'This model may be too big',
      `${model.name} needs more memory than this iPhone has. Loading it will probably close the app.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Load anyway', style: 'destructive', onPress: () => loadModel(model) },
      ],
    );
    return;
  }
  loadModel(model);
}

export async function download(model: Model) {
  const free = freeDiskMB();
  if (free !== null && model.sizeMB && model.sizeMB + 300 > free) {
    Alert.alert(
      'Not enough storage',
      `${model.name} needs ${formatMB(model.sizeMB)} and this iPhone has ${formatMB(free)} free.`,
    );
    return;
  }
  const begin = () => { haptic(); startDownload(model); };
  const resuming = !!app.get().downloads[model.id];
  if (!resuming && app.get().settings.cellularWarning && model.sizeMB >= 200) {
    const state = await Network.getNetworkStateAsync().catch(() => null);
    if (state?.type === Network.NetworkStateType.CELLULAR) {
      Alert.alert(
        'Download on mobile data?',
        `${model.name} is ${formatMB(model.sizeMB)}. You are not on Wi-Fi.`,
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Download', onPress: begin }],
      );
      return;
    }
  }
  begin();
}

export const pause = (model: Model) => { haptic(); pauseDownload(model); };

export function removeModel(model: Model) {
  const custom = model.group === 'custom';
  Alert.alert(`Delete ${model.name}?`, 'It will be removed from this iPhone.', [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Delete', style: 'destructive',
      onPress: async () => {
        if (app.get().engine.modelId === model.id) {
          await withEngine(() => engine.unloadModel());
          app.set({ engine: NO_ENGINE });
        }
        await deleteModel(model);
        app.set((s) => {
          const downloaded = { ...s.downloaded };
          delete downloaded[model.id];
          return { downloaded };
        });
        if (custom) {
          const customModels = app.get().customModels.filter((m) => m.id !== model.id);
          app.set({ customModels });
          store.saveCustomModels(customModels);
        }
      },
    },
  ]);
}

/** Adds a model from a link to a .gguf file. Returns an error to show, or null. */
export function addCustomModel(link: string): string | null {
  const model = modelFromUrl(link);
  if (!model) return 'That is not a link to a .gguf file.';
  if (allModels().some((m) => m.id === model.id || m.url === model.url)) return 'That model is already in the list.';
  const customModels = [...app.get().customModels, model];
  app.set({ customModels });
  store.saveCustomModels(customModels);
  download(model);
  return null;
}

// ---------- chat ----------

let stoppedByUser = false;
let interrupted = '';

/** Jobs that use the model but are not replies, kept for a moment when they will not slow a reply down. */
type SideJob = { chatId: string; facts: string[]; title: boolean };
let sideJobs: SideJob[] = [];

function queueSideJob(chatId: string, patch: { fact?: string; title?: boolean }) {
  let job = sideJobs.find((j) => j.chatId === chatId);
  if (!job) {
    job = { chatId, facts: [], title: false };
    sideJobs.push(job);
  }
  if (patch.fact) job.facts.push(patch.fact);
  if (patch.title) job.title = true;
}

/**
 * Runs the waiting side jobs. They replace what the model holds in memory, so
 * the next reply in a long chat would have to re-read the whole conversation.
 * That is why they wait until the chat is short or has been left.
 */
function flushSideJobs() {
  const jobs = sideJobs;
  sideJobs = [];
  for (const job of jobs) {
    withEngine(async () => {
      if (!engine.isLoaded()) return;
      const { settings } = app.get();
      if (job.title && settings.autoTitle) {
        const chat = app.get().chat.id === job.chatId ? app.get().chat : await store.chat(job.chatId);
        if (chat && !chat.titled && chat.messages.length >= 2) {
          const title = await suggestTitle(chat);
          if (title) {
            const chatList = await store.updateChat(chat.id, { title, titled: true });
            app.set((s) => ({
              chatList,
              ...(s.chat.id === chat.id ? { chat: { ...s.chat, title, titled: true } } : {}),
            }));
          }
        }
      }
      if (job.facts.length && settings.memoryOn && settings.autoMemory) {
        let list = app.get().memories;
        let saved = 0;
        for (const text of job.facts) {
          for (const fact of await extractFacts(text)) {
            const next = addMemory(list, fact);
            if (next) { list = next; saved++; }
          }
        }
        if (saved) {
          saveMemories(list);
          toast(saved === 1 ? 'Saved 1 memory' : `Saved ${saved} memories`);
        }
      }
    });
  }
}

async function runTurn(userText: string | null) {
  stoppedByUser = false;
  interrupted = '';
  const chatId = app.get().chat.id;
  const message: Message = { id: newId(), role: 'assistant', content: '' };
  app.set({ busy: true, live: message });
  await activateKeepAwakeAsync('chat').catch(() => {});

  await withEngine(async () => {
    const current = () => app.get().chat;
    const onScreen = () => current().id === chatId;
    try {
      const { settings, memories } = app.get();
      if (usedTokens(current(), settings, memories) > settings.nCtx - replyBudget(settings) - 48) {
        app.set({ status: 'Summarising earlier messages…' });
        await saveChat(await ensureRoom(current(), settings, memories));
        app.set({ status: '' });
      }
      let lastPaint = 0;
      const result = await engine.chat(
        promptMessages(current(), settings, memories),
        { temperature: settings.temperature, maxTokens: replyBudget(settings), thinking: settings.thinking },
        (content, reasoning) => {
          message.content = content;
          message.reasoning = reasoning;
          // Repainting on every token is wasteful; a few times a second reads the same.
          const now = Date.now();
          if (now - lastPaint > 70 && onScreen()) {
            lastPaint = now;
            app.set({ live: { ...message } });
          }
        },
      );
      message.content = result.content;
      message.reasoning = result.reasoning || undefined;
      message.speed = result.timings.speed;
      message.thought = result.timings.thought || undefined;
      if (interrupted) message.stopped = interrupted;
      if (message.content && onScreen()) {
        const chat = current();
        const messages = [...chat.messages, message];
        await saveChat({
          ...chat,
          messages,
          ctx: result.timings.used ? { used: result.timings.used, cut: chat.cut, count: messages.length } : null,
        });
      }
    } catch (e) {
      const partial = message.content.trim();
      if (partial && onScreen()) {
        const chat = current();
        await saveChat({
          ...chat,
          messages: [...chat.messages, { ...message, content: partial, stopped: interrupted || undefined }],
          ctx: null,
        });
      } else if (!stoppedByUser && !interrupted) {
        toast(`Something went wrong. ${String((e as Error)?.message ?? e)}`);
        haptic('warning');
      }
    }
    app.set({ live: null, status: '' });
  });

  deactivateKeepAwake('chat').catch(() => {});
  app.set({ busy: false });
  if (!stoppedByUser && !interrupted) haptic('success');

  // Side jobs wait if the chat is long. See flushSideJobs.
  const { chat, settings, memories, queued } = app.get();
  if (queued) {
    app.set({ queued: '' });
    // Send what was lined up, unless the reply was cut short or the chat was left.
    if (chat.id === chatId && !stoppedByUser && !interrupted) {
      if (!chat.titled && chat.messages.length >= 2) queueSideJob(chatId, { title: true });
      send(queued);
      return;
    }
    app.set({ draft: queued });
  }
  if (chat.id === chatId) {
    if (!chat.titled && chat.messages.length >= 2) queueSideJob(chatId, { title: true });
    if (userText && !stoppedByUser && !interrupted) queueSideJob(chatId, { fact: userText });
    if (usedTokens(chat, settings, memories) < 900) flushSideJobs();
  }
}

export async function send(text: string) {
  const remember = text.match(/^\/remember\s+([\s\S]+)/i);
  if (remember) {
    const next = addMemory(app.get().memories, remember[1]);
    if (next) { saveMemories(next); toast('Saved to memory'); } else toast('Already in memory');
    return;
  }
  const chat = app.get().chat;
  await saveChat({
    ...chat,
    title: chat.messages.length ? chat.title : text.replace(/\s+/g, ' ').slice(0, 48),
    messages: [...chat.messages, { id: newId(), role: 'user', content: text }],
  });
  runTurn(text);
}

/** The send button: sends the draft, queues it, or stops the reply being written. */
export function submit() {
  const { busy, draft, engine: state } = app.get();
  const text = draft.trim();
  if (busy) {
    // With something typed, line it up for after this reply. With nothing typed, stop.
    if (text) {
      haptic();
      app.set({ queued: text, draft: '' });
    } else {
      stop();
    }
    return;
  }
  if (!text || state.status !== 'ready') return;
  haptic();
  app.set({ draft: '' });
  send(text);
}

export function stop() {
  if (!app.get().busy) return;
  haptic();
  stoppedByUser = true;
  engine.stop();
}

export async function regenerate() {
  const { chat, busy, engine: state } = app.get();
  if (busy || state.status !== 'ready' || chat.messages[chat.messages.length - 1]?.role !== 'assistant') return;
  haptic();
  await saveChat({ ...chat, messages: chat.messages.slice(0, -1), ctx: null });
  runTurn(null);
}

/** Takes the last question back into the message box so it can be changed. */
export async function editLast() {
  const { chat, busy } = app.get();
  const index = chat.messages.map((m) => m.role).lastIndexOf('user');
  if (busy || index < 0) return;
  haptic();
  app.set({ draft: chat.messages[index].content });
  const messages = chat.messages.slice(0, index);
  if (messages.length) {
    await saveChat({ ...chat, messages, ctx: null, cut: Math.min(chat.cut, messages.length) });
  } else {
    const chatList = await store.deleteChat(chat.id);
    app.set({ chatList, chat: blankChat() });
  }
}

export async function openChat(id: string | null) {
  const { busy, chat } = app.get();
  if (id === chat.id) return;
  if (busy) stop();
  Speech.stop().catch(() => {});
  const next = (id && (await store.chat(id))) || blankChat();
  app.set({ chat: next, draft: '', queued: '', speakingId: null });
  // The chat just left no longer needs the model's attention. Catch up now.
  flushSideJobs();
}

export const newChat = () => {
  if (!app.get().chat.messages.length) return;
  haptic();
  openChat(null);
};

export function removeChat(meta: ChatMeta) {
  Alert.alert('Delete this chat?', meta.title, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Delete', style: 'destructive',
      onPress: async () => {
        sideJobs = sideJobs.filter((j) => j.chatId !== meta.id);
        const chatList = await store.deleteChat(meta.id);
        app.set({ chatList });
        if (app.get().chat.id === meta.id) openChat(null);
      },
    },
  ]);
}

export async function renameChat(id: string, title: string) {
  const clean = title.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!clean) return;
  const chatList = await store.updateChat(id, { title: clean, titled: true });
  app.set((s) => ({
    chatList,
    ...(s.chat.id === id ? { chat: { ...s.chat, title: clean, titled: true } } : {}),
  }));
}

export async function togglePin(meta: ChatMeta) {
  haptic('select');
  const pinned = !meta.pinned;
  const chatList = await store.updateChat(meta.id, { pinned });
  app.set((s) => ({ chatList, ...(s.chat.id === meta.id ? { chat: { ...s.chat, pinned } } : {}) }));
}

export async function shareChat(id: string) {
  const chat = app.get().chat.id === id ? app.get().chat : await store.chat(id);
  if (!chat?.messages.length) return;
  Share.share({ message: chatAsMarkdown(chat), title: chat.title }).catch(() => {});
}

export async function summariseNow() {
  const { busy, engine: state } = app.get();
  if (busy || state.status !== 'ready') return;
  app.set({ busy: true, status: 'Summarising earlier messages…' });
  await withEngine(async () => {
    const next = await compact(app.get().chat, app.get().settings, 2);
    if (next) await saveChat(next);
  });
  app.set({ busy: false, status: '' });
}

/** How full the model's context is for the open chat, as tokens. */
export const contextUse = (chat: Chat, settings: Settings, memories: Memory[]) =>
  usedTokens(chat, settings, memories);

// ---------- message actions ----------

export async function copyText(text: string) {
  await Clipboard.setStringAsync(text);
  haptic('select');
  toast('Copied');
}

export const shareText = (text: string) => { Share.share({ message: text }).catch(() => {}); };

/** Reads a message aloud, or stops if it is the one being read. */
export function speak(message: Message) {
  const id = message.id ?? message.content.slice(0, 24);
  const reading = app.get().speakingId;
  Speech.stop().catch(() => {});
  if (reading === id) {
    app.set({ speakingId: null });
    return;
  }
  const done = () => app.set((s) => (s.speakingId === id ? { speakingId: null } : {}));
  // Read the words, not the Markdown punctuation around them.
  const plain = message.content
    .replace(/```[\s\S]*?```/g, ' Code omitted. ')
    .replace(/[*_#>`~]+/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  app.set({ speakingId: id });
  Speech.speak(plain, { onDone: done, onStopped: done, onError: done });
}

// ---------- settings, memories, data ----------

export function changeSettings(patch: Partial<Settings>) {
  const before = app.get().settings.nCtx;
  const next = updateSettings(patch);
  // Changing the context size only takes effect on a reload.
  const { engine: state } = app.get();
  const model = findModel(state.modelId);
  if (next.nCtx !== before && state.status === 'ready' && model) loadModel(model, next.nCtx);
}

export function remember(text: string): boolean {
  const next = addMemory(app.get().memories, text);
  if (next) saveMemories(next);
  return !!next;
}

export const forget = (id: string) => saveMemories(app.get().memories.filter((m) => m.id !== id));

export function deleteAllChats() {
  Alert.alert('Delete every chat?', 'This cannot be undone.', [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Delete all', style: 'destructive',
      onPress: async () => {
        sideJobs = [];
        await store.deleteAllChats();
        app.set({ chatList: [], chat: blankChat(), draft: '' });
      },
    },
  ]);
}

export function deleteAllMemories() {
  Alert.alert('Delete every memory?', 'This cannot be undone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete all', style: 'destructive', onPress: () => saveMemories([]) },
  ]);
}

export async function exportEverything() {
  const chats = await store.allChats();
  if (!chats.length) {
    toast('There are no chats to export');
    return;
  }
  Share.share({ message: chats.map(chatAsMarkdown).join('\n\n---\n\n'), title: 'Pocket LLM chats' }).catch(() => {});
}
