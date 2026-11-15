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
  deleteModel, isDownloaded, modelUri, pauseDownload, restoreDownloads, resumeFailedDownloads, startDownload,
  type DownloadState,
} from './downloads';
import * as engine from './engine';
import {
  addMemory, compact, ensureRoom, extractFacts, promptMessages, replyBudget, suggestTitle, usedTokens,
} from './logic';
import { memoryStore } from './db';
import { deleteAllImages, deleteImages, keepImage, pickImage } from './images';
import { fit, formatMB, modelFromUrl, MODELS, visionAddon, type Model } from './models';
import {
  blankChat, chatAsMarkdown, DEFAULT_SETTINGS, newId, store,
  type Chat, type ChatMeta, type Memory, type Message, type Project, type Settings,
} from './storage';
import { createStore } from './store';
import { cleanTitle, isBrokenTitle } from './text';

export type EngineState = {
  status: 'none' | 'loading' | 'ready';
  modelId: string | null;
  fraction: number;
  error: string | null;
  gpu: boolean;
  /** True when the loaded model can look at photos. */
  vision: boolean;
};

type State = {
  /** False until saved data has been read at launch. */
  hydrated: boolean;
  settings: Settings;
  memories: Memory[];
  projects: Project[];
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
  /** A photo waiting to be sent with the next message. */
  attachment: string | null;
  crashed: boolean;
  toast: string;
  speakingId: string | null;
};

const NO_ENGINE: EngineState = { status: 'none', modelId: null, fraction: 0, error: null, gpu: false, vision: false };

export const app = createStore<State>({
  hydrated: false,
  settings: DEFAULT_SETTINGS,
  memories: [],
  projects: [],
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
  attachment: null,
  crashed: false,
  toast: '',
  speakingId: null,
});

export const allModels = () => [...MODELS, ...app.get().customModels];
/** Everything that can be downloaded: the models, and the photo add-ons some of them have. */
const allFiles = () => allModels().flatMap((m) => {
  const addon = visionAddon(m);
  return addon ? [m, addon] : [m];
});
export const findModel = (id: string | null) => allModels().find((m) => m.id === id) ?? null;
export const findProject = (id?: string) => app.get().projects.find((p) => p.id === id);

/** What the model is given alongside a chat's messages. An incognito chat gets no memories. */
function contextFor(chat: Chat) {
  const { settings, memories } = app.get();
  return { settings, memories: chat.incognito ? [] : memories, project: findProject(chat.projectId) };
}

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
  // An incognito chat only ever exists on screen.
  if (stamped.messages.length && !stamped.incognito) {
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

  const [savedSettings, memories, chatList, marker, customModels, projects] = await Promise.all([
    store.settings(), memoryStore.all(), store.chatList(), store.loadMarker(), store.customModels(),
    store.projects(),
  ]);
  let settings = savedSettings;
  // A marker left behind means the last load took the app down, most likely
  // by running out of memory. Do not auto-load into that again.
  if (marker) {
    await store.setLoadMarker(null);
    if (settings.nCtx > 2048) settings = { ...settings, nCtx: 2048 };
    store.saveSettings(settings);
  }
  app.set({ settings, memories, chatList, customModels, projects, crashed: !!marker });
  repairTitles(chatList);

  const models = allFiles();
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
      const file = allFiles().find((m) => m.id === modelId);
      toast(`${file?.name ?? 'Model'} is ready`);
      haptic('success');
      const model = findModel(modelId);
      const { engine: state } = app.get();
      if (model) {
        // The first model someone downloads is the one they want to talk to.
        if (state.status === 'none' && !app.get().settings.loadedOnce) loadWhenOnScreen(model);
      } else {
        // A photo add-on arrived: reload its model so it can start looking at photos.
        const base = allModels().find((m) => visionAddon(m)?.id === modelId);
        if (base && state.status === 'ready' && state.modelId === base.id) loadWhenOnScreen(base);
      }
    }
  });

  const preferred = findModel(settings.modelId);
  if (preferred && downloaded[preferred.id] && settings.loadedOnce && !marker) loadWhenOnScreen(preferred);

  AppState.addEventListener('change', onAppState);
  AppState.addEventListener('memoryWarning', onMemoryWarning);
  // A download that stopped because the connection dropped carries on when it comes back.
  Network.addNetworkStateListener((state) => {
    if (state.isConnected && state.isInternetReachable !== false) resumeFailedDownloads();
  });
}

/**
 * An earlier version saved some titles with the model's tags or a "Title:"
 * label still in them. Tidy those, or mark them to be named again.
 */
async function repairTitles(chatList: ChatMeta[]) {
  for (const meta of chatList.filter((c) => isBrokenTitle(c.title))) {
    const title = cleanTitle(meta.title);
    const next = await store.updateChat(meta.id, title ? { title } : { title: 'New chat', titled: false });
    app.set((s) => ({
      chatList: next,
      ...(s.chat.id === meta.id ? { chat: { ...s.chat, title: title || 'New chat', titled: !!title } } : {}),
    }));
  }
}

// ---------- staying well-behaved in the background ----------

/** Set when iOS asked for memory back and the model was let go to oblige. */
let reloadOnReturn: Model | null = null;

/** A model waiting to be loaded once the app is on screen. */
let loadWhenActive: Model | null = null;

/**
 * Loads a model now if the app is on screen, otherwise as soon as it is.
 * iOS can start the app in the background (to hand over a finished download),
 * and loading a model there would use the GPU, which iOS does not allow.
 */
function loadWhenOnScreen(model: Model) {
  if (AppState.currentState === 'active') loadModel(model);
  else loadWhenActive = model;
}

function onAppState(next: string) {
  if (next === 'inactive' || next === 'background') {
    // iOS closes an app that is still using the GPU when it reaches the
    // background, and the warning for that can arrive too late. So stop as
    // soon as the app starts to leave the screen, and keep what was written.
    if (app.get().busy) interrupted = 'Paused when you left the app.';
    engine.stop();
    Speech.stop().catch(() => {});
  } else if (next === 'active') {
    resumeFailedDownloads();
    const model = reloadOnReturn ?? loadWhenActive;
    reloadOnReturn = null;
    loadWhenActive = null;
    if (model && app.get().engine.status === 'none') loadModel(model);
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
  app.set({ engine: { status: 'loading', modelId: model.id, fraction: 0, error: null, gpu: false, vision: false } });
  await withEngine(async () => {
    await store.setLoadMarker({ modelId: model.id, nCtx });
    await activateKeepAwakeAsync('load').catch(() => {});
    try {
      let last = 0;
      const addon = visionAddon(model);
      const projector = addon && app.get().downloaded[addon.id] ? modelUri(addon) : undefined;
      const { gpu, vision } = await engine.loadModel(modelUri(model), nCtx, (fraction) => {
        // The engine reports progress far more often than the eye needs.
        if (fraction - last < 0.02 && fraction < 1) return;
        last = fraction;
        app.set((s) => (s.engine.status === 'loading' ? { engine: { ...s.engine, fraction } } : {}));
      }, projector);
      app.set({ engine: { status: 'ready', modelId: model.id, fraction: 1, error: null, gpu, vision }, crashed: false });
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
        const addon = visionAddon(model);
        if (addon) await deleteModel(addon);
        app.set((s) => {
          const downloaded = { ...s.downloaded };
          delete downloaded[model.id];
          if (addon) delete downloaded[addon.id];
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
  // These use the GPU too, so they wait until the app is on screen.
  if (AppState.currentState !== 'active') return;
  const jobs = sideJobs;
  sideJobs = [];
  for (const job of jobs) {
    withEngine(async () => {
      if (!engine.isLoaded()) return;
      if (AppState.currentState !== 'active') {
        sideJobs.push(job);
        return;
      }
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
      const { settings, memories, project } = contextFor(current());
      if (usedTokens(current(), settings, memories, project) > settings.nCtx - replyBudget(settings) - 48) {
        app.set({ status: 'Summarising earlier messages…' });
        await saveChat(await ensureRoom(current(), settings, memories, project));
        app.set({ status: '' });
      }
      let lastPaint = 0;
      const result = await engine.chat(
        promptMessages(current(), settings, memories, project),
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
  const { chat, queued } = app.get();
  const { settings, memories, project } = contextFor(chat);
  if (queued) {
    app.set({ queued: '' });
    // Send what was lined up, unless the reply was cut short or the chat was left.
    if (chat.id === chatId && !stoppedByUser && !interrupted) {
      if (!chat.titled && !chat.incognito && chat.messages.length >= 2) queueSideJob(chatId, { title: true });
      send(queued);
      return;
    }
    app.set({ draft: queued });
  }
  // An incognito chat is never named and never feeds memories.
  if (chat.id === chatId && !chat.incognito) {
    if (!chat.titled && chat.messages.length >= 2) queueSideJob(chatId, { title: true });
    if (userText && !stoppedByUser && !interrupted) queueSideJob(chatId, { fact: userText });
    if (usedTokens(chat, settings, memories, project) < 900) flushSideJobs();
  }
}

export async function send(text: string, photo: string | null = null) {
  const remember = text.match(/^\/remember\s+([\s\S]+)/i);
  if (remember) {
    const next = addMemory(app.get().memories, remember[1]);
    if (next) { saveMemories(next); toast('Saved to memory'); } else toast('Already in memory');
    return;
  }
  const chat = app.get().chat;
  // A freshly picked photo is copied into the app's storage. An incognito chat leaves no copy.
  const fresh = !!photo && /^(file|blob|data|https?):/.test(photo);
  const image = photo && fresh && !chat.incognito ? await keepImage(photo) : photo ?? undefined;
  await saveChat({
    ...chat,
    title: chat.messages.length ? chat.title : (text || 'Photo').replace(/\s+/g, ' ').slice(0, 48),
    messages: [...chat.messages, { id: newId(), role: 'user', content: text, image }],
  });
  runTurn(text);
}

/** Lets the user pick a photo to send with their next message. */
export async function attachPhoto() {
  const uri = await pickImage().catch(() => null);
  if (uri) app.set({ attachment: uri });
}

/** The send button: sends the draft, queues it, or stops the reply being written. */
export function submit() {
  const { busy, draft, attachment, engine: state } = app.get();
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
  if ((!text && !attachment) || state.status !== 'ready') return;
  haptic();
  app.set({ draft: '', attachment: null });
  send(text, attachment);
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

/**
 * Takes one of the user's messages back into the message box so it can be
 * changed. That message and everything after it leave the chat.
 */
export async function editMessage(id: string | undefined) {
  const { chat, busy } = app.get();
  const found = id ? chat.messages.findIndex((m) => m.id === id) : -1;
  const index = found >= 0 ? found : chat.messages.map((m) => m.role).lastIndexOf('user');
  if (busy || index < 0 || chat.messages[index].role !== 'user') return;
  haptic();
  app.set({ draft: chat.messages[index].content, attachment: chat.messages[index].image ?? null });
  const messages = chat.messages.slice(0, index);
  if (messages.length) {
    await saveChat({ ...chat, messages, ctx: null, cut: Math.min(chat.cut, messages.length) });
  } else {
    const chatList = chat.incognito ? app.get().chatList : await store.deleteChat(chat.id);
    app.set({ chatList, chat: blankChat({ projectId: chat.projectId, incognito: chat.incognito }) });
  }
}

export async function openChat(id: string | null, fresh: { projectId?: string; incognito?: boolean } = {}) {
  const { busy, chat } = app.get();
  if (id === chat.id) return;
  if (busy) stop();
  Speech.stop().catch(() => {});
  const next = (id && (await store.chat(id))) || blankChat(fresh);
  app.set({ chat: next, draft: '', queued: '', attachment: null, speakingId: null });
  // The chat just left no longer needs the model's attention. Catch up now.
  flushSideJobs();
}

/** Starts a new chat, optionally inside a project or as an incognito chat. */
export function newChat(options: { projectId?: string; incognito?: boolean } = {}) {
  const { chat } = app.get();
  const same = !chat.messages.length && chat.projectId === options.projectId && !!chat.incognito === !!options.incognito;
  if (same) return;
  haptic();
  openChat(null, options);
}

export function removeChat(meta: ChatMeta) {
  Alert.alert('Delete this chat?', meta.title, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Delete', style: 'destructive',
      onPress: async () => {
        sideJobs = sideJobs.filter((j) => j.chatId !== meta.id);
        const gone = await store.chat(meta.id);
        deleteImages((gone?.messages ?? []).map((m) => m.image));
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

// ---------- projects ----------

export function createProject(name: string): Project | null {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!clean) return null;
  const project: Project = { id: newId(), name: clean, instructions: '' };
  app.set((s) => ({ projects: [project, ...s.projects] }));
  store.saveProject(project);
  haptic('success');
  return project;
}

export function updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'instructions'>>) {
  const current = findProject(id);
  if (!current) return;
  const next = { ...current, ...patch };
  app.set((s) => ({ projects: s.projects.map((p) => (p.id === id ? next : p)) }));
  store.saveProject(next);
}

export function deleteProject(project: Project, then?: () => void) {
  Alert.alert(`Delete ${project.name}?`, 'Its chats are kept.', [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Delete', style: 'destructive',
      onPress: async () => {
        const chatList = await store.deleteProject(project.id);
        app.set((s) => ({
          chatList,
          projects: s.projects.filter((p) => p.id !== project.id),
          ...(s.chat.projectId === project.id ? { chat: { ...s.chat, projectId: undefined } } : {}),
        }));
        then?.();
      },
    },
  ]);
}

/** Puts a chat in a project, or takes it out when `projectId` is null. */
export async function moveChat(id: string, projectId: string | null) {
  const chatList = await store.updateChat(id, { projectId });
  app.set((s) => ({
    chatList,
    ...(s.chat.id === id ? { chat: { ...s.chat, projectId: projectId ?? undefined } } : {}),
  }));
}

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
        deleteAllImages();
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
