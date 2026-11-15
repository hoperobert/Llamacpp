// The app's state and everything it can do. Screens read from `app` and call
// the functions below; nothing in here draws anything.

import { Alert, AppState, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Network from 'expo-network';
import { router } from 'expo-router';
import * as Speech from 'expo-speech';
import * as Updates from 'expo-updates';

import { onOrOff, parseCommand, subjectOf, type Command } from './commands';
import { bestContext, DEFAULT_KV_KB, kvKBPerToken, trainedContext } from './context';
import { freeDiskMB, ramMB } from './device';
import {
  deleteModel, fileSizeMB, isDownloaded, modelUri, pauseDownload, restoreDownloads, resumeFailedDownloads, startDownload,
  type DownloadState,
} from './downloads';
import * as engine from './engine';
import {
  addMemory, compact, ensureRoom, extractFacts, promptMessages, replyBudget, suggestTitle, usedTokens,
} from './logic';
import { memoryStore } from './db';
import { deleteAllImages, deleteImages, keepImage, pickImage, takePhoto } from './images';
import {
  addText, libraryFiles, libraryReady, lookup, prepare, removeSource, removeText, restoreLibrary, SOURCES,
  sourceDownload, sourceForDownload, type LibraryFile, type Source, type SourceState,
} from './library';
import { fit, formatMB, modelFromUrl, MODELS, visionAddon, type Model } from './models';
import {
  blankChat, chatAsMarkdown, DEFAULT_SETTINGS, newId, store, STYLES,
  type Chat, type ChatMeta, type Memory, type Message, type Project, type Settings,
} from './storage';
import { asks, referenceText, worthLookingUp, worthUsing, type Passage } from './retrieval';
import { describeClose, type Session } from './session';
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
  /** The offline library: each source's state, and the user's own files. */
  library: Record<string, SourceState>;
  libraryFiles: LibraryFile[];
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
  /** How the last run of the app ended, for the bottom of Settings. */
  lastClose: string;
  /** The last error nothing caught. */
  lastError: string;
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
  library: {},
  libraryFiles: [],
  busy: false,
  status: '',
  live: null,
  draft: '',
  queued: '',
  attachment: null,
  crashed: false,
  lastClose: '',
  lastError: '',
  toast: '',
  speakingId: null,
});

export const allModels = () => [...MODELS, ...app.get().customModels];
/** Everything that can be downloaded: the models, and the photo add-ons some of them have. */
const allFiles = () => [
  ...allModels().flatMap((m) => {
    const addon = visionAddon(m);
    return addon ? [m, addon] : [m];
  }),
  ...SOURCES.map(sourceDownload),
];
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

/**
 * Fixes that are only code arrive over the air, without a new build. One that
 * is waiting is fetched and switched to here, at launch and before any model
 * is loaded: switching restarts the app's code, and a model loaded by the old
 * code would be left behind in memory.
 *
 * Returns quickly when there is nothing new or no connection.
 */
async function takeUpdate() {
  if (!Updates.isEnabled) return;
  const within = <T>(ms: number, job: Promise<T>) =>
    Promise.race([job, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
  try {
    const check = await within(3000, Updates.checkForUpdateAsync());
    if (!check?.isAvailable) return;
    const fetched = await within(20000, Updates.fetchUpdateAsync());
    if (fetched?.isNew && app.get().engine.status === 'none') await Updates.reloadAsync();
  } catch {
    // No connection, or nothing to fetch. The app runs as it is.
  }
}

/**
 * An error that nothing catches closes the app on an iPhone. Almost none are
 * worth that: the app can carry on, and the error is kept so it can be seen at
 * the bottom of Settings and put right.
 */
function keepGoingAfterErrors() {
  const errors = (globalThis as {
    ErrorUtils?: { setGlobalHandler: (handler: (error: unknown, fatal?: boolean) => void) => void };
  }).ErrorUtils;
  errors?.setGlobalHandler((error) => {
    const text = String((error as Error)?.stack ?? (error as Error)?.message ?? error).slice(0, 600);
    console.warn('Uncaught error', text);
    app.set({ lastError: text });
    store.setLastError({ at: Date.now(), text });
  });
}

let lookedForUpdate = 0;

/**
 * The app is rarely started from cold: it mostly comes back from the
 * background, sometimes for days. So newer code is also looked for on return,
 * at most every ten minutes, and switched to when nothing is going on: no
 * reply being written and nothing typed. The model is let go first, because
 * switching restarts the app's code and would leave it behind in memory. It is
 * loaded again as the app starts.
 */
async function takeUpdateOnReturn() {
  if (!Updates.isEnabled || Date.now() - lookedForUpdate < 10 * 60 * 1000) return;
  lookedForUpdate = Date.now();
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return;
    const fetched = await Updates.fetchUpdateAsync();
    const { busy, draft, engine: state } = app.get();
    if (!fetched.isNew || busy || draft.trim() || state.status === 'loading' || AppState.currentState !== 'active') return;
    const model = findModel(state.modelId);
    await withEngine(() => engine.unloadModel());
    try {
      await Updates.reloadAsync();
    } catch {
      // The switch did not happen, so the model is needed again after all.
      app.set({ engine: NO_ENGINE });
      if (model) loadModel(model);
    }
  } catch {
    // No connection, or nothing to fetch. It is tried again later.
  }
}

let started = false;

export async function start() {
  if (started) return;
  started = true;
  keepGoingAfterErrors();
  lookedForUpdate = Date.now();
  const updated = takeUpdate();

  const [savedSettings, memories, chatList, marker, customModels, projects, previous] = await Promise.all([
    store.settings(), memoryStore.all(), store.chatList(), store.loadMarker(), store.customModels(),
    store.projects(), store.session(),
  ]);
  app.set({ lastClose: describeClose(previous, Date.now()), lastError: (await store.lastError())?.text ?? '' });
  note({ phase: AppState.currentState ?? 'active', since: Date.now() });
  const settings = savedSettings;
  // A marker left behind means the last load took the app down, most likely
  // by running out of memory. Do not auto-load into that again.
  // A marker left behind means the last load took the app down. Do not load
  // straight into that again; the user can choose what to do.
  if (marker) await store.setLoadMarker(null);
  app.set({ settings, memories, chatList, customModels, projects, crashed: !!marker });
  repairTitles(chatList);
  // If iOS closed the app while it was in the background, carry on where it was left.
  const last = await store.lastOpen();
  if (last && Date.now() - last.at < RETURN_WITHIN_MS && chatList.some((c) => c.id === last.chatId)) {
    await openChat(last.chatId);
  }

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
      const source = sourceForDownload(modelId);
      if (source) {
        // A library source has arrived: build its index.
        prepare(source);
        return;
      }
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

  await restoreLibrary(
    (id, state) => {
      const before = app.get().library[id]?.status;
      app.set((s) => {
        const library = { ...s.library };
        if (state) library[id] = state;
        else delete library[id];
        return { library };
      });
      doing('preparing the library', state?.status === 'preparing');
      if (state?.status === 'ready' && before === 'preparing') {
        toast(`${SOURCES.find((s) => s.id === id)?.name ?? 'Library'} is ready`);
        haptic('success');
        // Someone who just added a library wants it used.
        updateSettings({ lookup: true });
      }
    },
    (source) => !!downloaded[sourceDownload(source).id],
  );
  app.set({ libraryFiles: await libraryFiles() });

  // The model waits for a moment in case newer code is about to take over.
  await updated;
  const preferred = findModel(settings.modelId);
  if (preferred && downloaded[preferred.id] && settings.loadedOnce && !marker) loadWhenOnScreen(preferred);

  AppState.addEventListener('change', onAppState);
  AppState.addEventListener('memoryWarning', () => note({ warnings: session.warnings + 1 }));
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

/** A model waiting to be loaded once the app is on screen. */
let loadWhenActive: Model | null = null;

/** A reply that could not be started because the app had left the screen. It is written on return. */
let resumeTurn: { chatId: string; userText: string | null } | null = null;

/** What the app is doing right now, saved as it changes. See session.ts. */
let session: Session = { phase: 'active', since: Date.now(), doing: [], model: null, warnings: 0 };

function note(patch: Partial<Session>) {
  session = { ...session, ...patch };
  store.setSession(session);
}

/** Marks the start or end of something worth knowing about if the app closes during it. */
function doing(what: string, on: boolean) {
  const rest = session.doing.filter((d) => d !== what);
  note({ doing: on ? [...rest, what] : rest });
}

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
  try {
    appStateChanged(next);
  } catch (error) {
    // Nothing that happens as the app comes and goes is worth closing it for.
    console.warn('App state', error);
  }
}

function appStateChanged(next: string) {
  if (next === 'inactive' || next === 'background') {
    // iOS closes an app that is still using the GPU when it reaches the
    // background, and the warning for that can arrive too late. So stop as
    // soon as the app starts to leave the screen, and keep what was written.
    if (app.get().busy) interrupted = 'Paused when you left the app.';
    engine.stop();
    Speech.stop().catch(() => {});
    if (session.phase === 'active') note({ phase: next, since: Date.now(), warnings: 0 });
    else note({ phase: next });
    // The model stays loaded, so coming back is instant. iOS may still close
    // the app to make room for others; note the chat, to come back to it then.
    const { chat } = app.get();
    store.setLastOpen(chat.messages.length && !chat.incognito ? { chatId: chat.id, at: Date.now() } : null);
  } else if (next === 'active') {
    note({ phase: next, since: Date.now() });
    takeUpdateOnReturn();
    resumeFailedDownloads();
    const model = loadWhenActive;
    loadWhenActive = null;
    if (model && app.get().engine.status === 'none') loadModel(model);
    resumeIfWaiting();
  }
}

/**
 * Writes a reply that could not be written because the app had left the
 * screen. It waits for the app to be back and for the engine to be free, so it
 * is tried both when the app returns and when a reply ends.
 */
function resumeIfWaiting() {
  const turn = resumeTurn;
  const { chat, busy } = app.get();
  if (!turn || busy || AppState.currentState !== 'active') return;
  resumeTurn = null;
  if (chat.id === turn.chatId && chat.messages.at(-1)?.role === 'user') runTurn(turn.userText);
}

/** How long after leaving the app a relaunch still returns to the chat that was open. */
const RETURN_WITHIN_MS = 30 * 60 * 1000;

// ---------- models ----------

/**
 * The context to give a model. Chosen to fit this phone unless the user has
 * picked a size themselves.
 */
async function contextForModel(model: Model): Promise<number> {
  const { settings, downloaded } = app.get();
  if (!settings.autoContext) return settings.nCtx;
  // A model from the catalogue has its needs written down. One added from a link says in its file.
  const details = model.kvKB ? null : await engine.modelDetails(modelUri(model));
  const addon = visionAddon(model);
  return bestContext({
    fileMB: model.sizeMB || fileSizeMB(model),
    kvKB: model.kvKB ?? (details && kvKBPerToken(details)) ?? DEFAULT_KV_KB,
    extraMB: addon && downloaded[addon.id] ? addon.sizeMB : 0,
    ramMB,
    trained: details ? trainedContext(details) : null,
  });
}

export async function loadModel(model: Model) {
  if (AppState.currentState !== 'active') {
    loadWhenActive = model;
    return;
  }
  app.set({ engine: { status: 'loading', modelId: model.id, fraction: 0, error: null, gpu: false, vision: false } });
  await withEngine(async () => {
    doing('loading a model', true);
    note({ model: null });
    const nCtx = await contextForModel(model);
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
      note({ model: model.name });
      // The size in use is kept in the settings, where the rest of the app reads it.
      updateSettings({ modelId: model.id, loadedOnce: true, nCtx });
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
    doing('loading a model', false);
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
  const { downloaded, downloads } = app.get();
  // The add-on that lets this model look at photos, if it has one and it is not here yet.
  const wanted = visionAddon(model);
  const addon = wanted && !downloaded[wanted.id] && !downloads[wanted.id] ? wanted : null;
  const sizeMB = model.sizeMB + (addon?.sizeMB ?? 0);
  const free = freeDiskMB();
  if (free !== null && model.sizeMB && sizeMB + 300 > free) {
    Alert.alert(
      'Not enough storage',
      `${model.name} needs ${formatMB(sizeMB)} and this iPhone has ${formatMB(free)} free.`,
    );
    return;
  }
  const begin = () => {
    haptic();
    startDownload(model);
    // A model that can look at photos gets what it needs for that at the same time.
    if (addon) startDownload(addon);
  };
  const resuming = !!app.get().downloads[model.id];
  if (!resuming && app.get().settings.cellularWarning && sizeMB >= 200) {
    const state = await Network.getNetworkStateAsync().catch(() => null);
    if (state?.type === Network.NetworkStateType.CELLULAR) {
      Alert.alert(
        'Download on mobile data?',
        `${model.name} is ${formatMB(sizeMB)}. You are not on Wi-Fi.`,
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
      doing('naming a chat', true);
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
      doing('naming a chat', false);
      // Cut short by leaving the app: try again another time.
      if (AppState.currentState !== 'active') sideJobs.push(job);
    });
  }
}

async function runTurn(userText: string | null) {
  stoppedByUser = false;
  interrupted = '';
  const chatId = app.get().chat.id;
  if (AppState.currentState !== 'active') {
    // Sent just as the app was left. The reply is written on return.
    resumeTurn = { chatId, userText };
    return;
  }
  const message: Message = { id: newId(), role: 'assistant', content: '' };
  app.set({ busy: true, live: message });
  doing('writing a reply', true);
  await activateKeepAwakeAsync('chat').catch(() => {});

  await withEngine(async () => {
    const current = () => app.get().chat;
    const onScreen = () => current().id === chatId;
    try {
      const { settings, memories, project } = contextFor(current());
      if (usedTokens(current(), settings, memories, project) > settings.nCtx - replyBudget(settings) - 48) {
        app.set({ status: 'Summarising earlier messages…' });
        const roomier = await ensureRoom(current(), settings, memories, project);
        // A summary cut short by leaving the app must not replace the messages it stands for.
        if (stoppedByUser || AppState.currentState !== 'active') throw new engine.Interrupted();
        await saveChat(roomier);
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
      // Cut off by leaving the app before a word of the answer was written (it may
      // still have been thinking). There is nothing to keep, so it is asked again on return.
      if (interrupted && !stoppedByUser && !message.content) resumeTurn = { chatId, userText };
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
      if (engine.isInterrupted(e) && !stoppedByUser && !partial) {
        // The app left the screen before the reply could begin. Begin it on return.
        interrupted = interrupted || 'Paused when you left the app.';
        resumeTurn = { chatId, userText };
      }
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
  doing('writing a reply', false);
  app.set({ busy: false });
  if (resumeTurn) {
    // Cut off by leaving. If the app is already back, start again now; otherwise when it returns.
    resumeIfWaiting();
    return;
  }
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
  const typed = parseCommand(text);
  if (typed && !typed.command.prompt) {
    runCommand(typed.command, typed.arg);
    return;
  }
  const chat = app.get().chat;
  // A freshly picked photo is copied into the app's storage. An incognito chat leaves no copy.
  const fresh = !!photo && /^(file|blob|data|https?):/.test(photo);
  const image = photo && fresh && !chat.incognito ? await keepImage(photo) : photo ?? undefined;
  // "/plan a trip to Rome" is about a trip to Rome.
  const subject = subjectOf(text);
  // A question that comes with a photo is about the photo, not about the words in it.
  const found = photo ? {} : await lookUp(subject, chat);
  await saveChat({
    ...chat,
    title: chat.messages.length ? chat.title : (subject || 'Photo').replace(/\s+/g, ' ').slice(0, 48),
    messages: [...chat.messages, { id: newId(), role: 'user', content: text, image, ...found }],
  });
  runTurn(text);
}

/**
 * Looks a question up in the offline library, when that is switched on.
 * Returns what to keep with the message: the passages for the model, and their titles to show.
 */
async function lookUp(text: string, chat: Chat): Promise<{ context?: string; sources?: string[] }> {
  if (!app.get().settings.lookup || !libraryReady() || !worthLookingUp(text)) return {};
  // A short follow-up ("how tall is it?") only makes sense with the question before it.
  const before = [...chat.messages].reverse().find((m) => m.role === 'user');
  const followUp = text.split(/\s+/).length < 6;
  // If that question was about a photo, so is this one.
  if (followUp && before?.image) return {};
  const previous = before?.content ?? '';
  const question = followUp && previous ? `${previous} ${text}` : text;
  const found = worthUsing(await lookup(question, 3, asks(text)).catch(() => []), text);
  // What the model was already given earlier in this chat is still in front of it.
  const given = chat.messages.slice(chat.cut).map((m) => m.context ?? '').join('\n');
  const passages = found.filter((p) => !given.includes(p.body.slice(0, 80)));
  if (!passages.length) return {};
  // A model with a small context is given less to read, so there is room left for the chat.
  const room = Math.min(3200, Math.round(app.get().settings.nCtx * 0.8));
  return {
    context: referenceText(passages, room, sourceName),
    sources: [...new Set(passages.map((p) => p.title))],
  };
}

/** Where a passage is from, as the model should call it: "Wikipedia", "Dictionary", or the name of a file. */
function sourceName(passage: Passage): string {
  const source = SOURCES.find((s) => s.id === passage.source);
  if (!source) return passage.source.replace(/\.[a-z0-9]+$/i, '');
  return source.name.startsWith('Wikipedia') ? 'Wikipedia' : source.name;
}

/** Lets the user pick a photo, or take one, to send with their next message. */
export async function attachPhoto(from: 'library' | 'camera' = 'library') {
  const uri = await (from === 'camera' ? takePhoto() : pickImage()).catch(() => null);
  if (uri === 'denied') toast('Allow the camera in Settings');
  else if (uri) app.set({ attachment: uri });
}

/** The send button: sends the draft, queues it, or stops the reply being written. */
export function submit() {
  const { busy, draft, attachment, engine: state } = app.get();
  const text = draft.trim();
  const typed = parseCommand(text);
  if (typed && !typed.command.prompt) {
    // A command that acts on the app runs straight away, whatever the model is doing.
    haptic();
    app.set({ draft: '' });
    runCommand(typed.command, typed.arg);
    return;
  }
  if (typed?.command.prompt && !typed.arg && !typed.command.prompt.bare) {
    toast(`Add ${typed.command.takes} after /${typed.command.name}`);
    return;
  }
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

// ---------- slash commands ----------

const LENGTHS: Record<string, number> = { short: 256, medium: 768, long: 1536, max: 3072 };

/** Carries out a command that acts on the app. Requests to the model are sent as messages instead. */
export function runCommand(command: Command, arg: string) {
  const { chat, settings, engine: state, downloaded } = app.get();
  const hasMessages = chat.messages.length > 0;
  const needsChat = () => { if (!hasMessages) toast('Nothing in this chat yet'); return hasMessages; };
  switch (command.name) {
    case 'new': newChat({ projectId: chat.projectId }); break;
    case 'incognito': newChat({ incognito: true }); break;
    case 'retry': regenerate(); break;
    case 'stop': stop(); break;
    case 'compact': summariseNow(); break;
    case 'context': {
      const { memories, project } = contextFor(chat);
      const used = usedTokens(chat, settings, memories, project);
      toast(`Context ${Math.min(100, Math.round((used / settings.nCtx) * 100))}% full`);
      break;
    }
    case 'rename':
      if (!needsChat() || chat.incognito) break;
      if (arg) renameChat(chat.id, arg);
      else Alert.prompt('Rename Chat', undefined, (title) => renameChat(chat.id, title), 'plain-text', chat.title);
      break;
    case 'pin': if (needsChat() && !chat.incognito) togglePin(chat); break;
    case 'share': if (needsChat()) shareChat(chat.id); break;
    case 'delete': if (needsChat()) removeChat(chat); break;
    case 'goal': setGoal(arg); break;

    case 'model': {
      if (!arg) { router.push('/models'); break; }
      const wanted = arg.toLowerCase().replace(/\s+/g, '');
      const model = allModels().find((m) => downloaded[m.id] && m.name.toLowerCase().replace(/\s+/g, '').includes(wanted));
      if (!model) toast(`No model like "${arg}" on this iPhone`);
      else if (model.id !== state.modelId || state.status !== 'ready') switchModel(model);
      break;
    }
    case 'think': {
      const thinking = onOrOff(arg, settings.thinking);
      if (thinking === null) { toast('Use /think on or /think off'); break; }
      changeSettings({ thinking });
      toast(thinking ? 'Thinking first' : 'Not thinking first');
      break;
    }
    case 'lookup': {
      if (!libraryReady()) { router.push('/library'); break; }
      const lookup = onOrOff(arg, settings.lookup);
      if (lookup === null) { toast('Use /lookup on or /lookup off'); break; }
      changeSettings({ lookup });
      toast(lookup ? 'Looking things up' : 'Not looking things up');
      break;
    }
    case 'style': {
      const style = STYLES.find((s) => arg && s.id.startsWith(arg.toLowerCase()));
      if (!style) { toast(`Styles: ${STYLES.map((s) => s.id).join(', ')}`); break; }
      changeSettings({ style: style.id });
      toast(`Style: ${style.label}`);
      break;
    }
    case 'length': {
      const name = Object.keys(LENGTHS).find((key) => arg && key.startsWith(arg.toLowerCase()));
      if (!name) { toast('Lengths: short, medium, long, max'); break; }
      changeSettings({ maxTokens: LENGTHS[name] });
      toast(`Length: ${name}`);
      break;
    }

    case 'remember':
      if (!arg) toast('Add what to remember after /remember');
      else toast(remember(arg) ? 'Saved to memory' : 'Already in memory');
      break;
    case 'memory': router.push('/settings/memory'); break;
    case 'chats': router.push('/chats'); break;
    case 'projects': router.push('/projects'); break;
    case 'library': router.push('/library'); break;
    case 'settings': router.push('/settings'); break;
    // Typing a slash is what lists the commands.
    case 'help': app.set({ draft: '/' }); break;
  }
}

/** Sets, shows or clears what this chat is for. The model is reminded of it in every reply. */
async function setGoal(arg: string) {
  const { chat } = app.get();
  if (!arg) {
    toast(chat.goal ? `Goal: ${chat.goal}` : 'Add the goal after /goal');
    return;
  }
  const clearing = ['clear', 'off', 'none', 'done'].includes(arg.toLowerCase());
  const goal = clearing ? undefined : arg.replace(/\s+/g, ' ').slice(0, 300);
  // The measured size of the chat no longer holds once the instructions change.
  const next = { ...chat, goal, ctx: null };
  if (chat.messages.length) await saveChat(next);
  else app.set({ chat: next });
  haptic('success');
  toast(clearing ? 'Goal cleared' : 'Goal set');
}

// ---------- the offline library ----------

/** Downloads a library source. Its index is built when it arrives. */
export function installSource(source: Source) {
  // The index is built beside the download, so both have to fit until it is done.
  const free = freeDiskMB();
  const needed = source.sizeMB + source.diskMB;
  if (free !== null && !app.get().downloads[sourceDownload(source).id] && needed + 300 > free) {
    Alert.alert('Not enough storage', `${source.name} needs ${formatMB(needed)} and this iPhone has ${formatMB(free)} free.`);
    return;
  }
  download(sourceDownload(source));
}

export function deleteSource(source: Source) {
  Alert.alert(`Remove ${source.name}?`, 'It will be deleted from this iPhone.', [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Remove', style: 'destructive',
      onPress: async () => {
        const file = sourceDownload(source);
        await deleteModel(file);
        app.set((s) => {
          const downloaded = { ...s.downloaded };
          delete downloaded[file.id];
          return { downloaded };
        });
        await removeSource(source);
      },
    },
  ]);
}

/** Adds a text file to the library. Returns an error to show, or null. */
export async function addLibraryFile(name: string, text: string): Promise<string | null> {
  if (!text.trim()) return 'That file has no text in it.';
  try {
    app.set({ libraryFiles: await addText(name, text) });
    // Adding something to look things up in turns looking up on.
    if (!app.get().settings.lookup) changeSettings({ lookup: true });
    haptic('success');
    return null;
  } catch (e) {
    return `Could not add that file. ${String((e as Error)?.message ?? e)}`;
  }
}

export async function deleteLibraryFile(name: string) {
  app.set({ libraryFiles: await removeText(name) });
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
  const before = app.get().settings;
  const next = updateSettings(patch);
  // Changing the context size only takes effect on a reload.
  const { engine: state } = app.get();
  const model = findModel(state.modelId);
  const changed = next.nCtx !== before.nCtx || next.autoContext !== before.autoContext;
  if (changed && state.status === 'ready' && model) loadModel(model);
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
