// Model downloads that keep going in the background.
//
// The downloads are handed to iOS itself (a background URL session), so they
// continue while the app is in the background, the phone is locked, or the
// app has been closed. When the app next opens it re-attaches to them.

import {
  completeHandler,
  createDownloadTask,
  directories,
  getExistingDownloadTasks,
  setConfig,
  type DownloadTask,
} from '@kesha-antonov/react-native-background-downloader';
import { File, Paths } from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Model } from './models';
import { store } from './storage';

export type DownloadState = {
  status: 'downloading' | 'paused' | 'failed';
  loaded: number;
  total: number;
  /** Bytes per second, averaged over the last few seconds. 0 when unknown. */
  speed: number;
  error?: string;
};

type Listener = (modelId: string, state: DownloadState | null, done: boolean) => void;

const tasks = new Map<string, DownloadTask>();
const samples = new Map<string, { at: number; loaded: number; speed: number }>();
let listener: Listener = () => {};
let userPaused = new Set<string>();
/** Downloads already restarted once after their link expired, so a real refusal is not retried forever. */
const restarted = new Set<string>();

const doneKey = (model: Model) => `downloaded:${model.id}`;
const modelFile = (model: Model) => new File(Paths.document, model.file);

/** The path to hand to the engine. */
export const modelUri = (model: Model) => modelFile(model).uri;

/** Size of the downloaded file in MB, or 0 if it is not there. */
export function fileSizeMB(model: Model): number {
  try {
    const file = modelFile(model);
    return file.exists ? Math.round((file.size ?? 0) / 1e6) : 0;
  } catch {
    return 0;
  }
}

export async function isDownloaded(model: Model): Promise<boolean> {
  if (!(await AsyncStorage.getItem(doneKey(model)))) return false;
  try {
    return modelFile(model).exists;
  } catch {
    return false;
  }
}

const totalOf = (model: Model, task: DownloadTask) =>
  task.bytesTotal > 0 ? task.bytesTotal : model.sizeMB * 1e6;

/** A smoothed download speed, so the time remaining does not jump around. */
function speedOf(id: string, loaded: number): number {
  const now = Date.now();
  const last = samples.get(id);
  if (!last || loaded < last.loaded) {
    samples.set(id, { at: now, loaded, speed: 0 });
    return 0;
  }
  const seconds = (now - last.at) / 1000;
  if (seconds < 1) return last.speed;
  const current = (loaded - last.loaded) / seconds;
  const speed = last.speed ? last.speed * 0.6 + current * 0.4 : current;
  samples.set(id, { at: now, loaded, speed });
  return speed;
}

function setUserPaused(id: string, paused: boolean) {
  if (paused) userPaused.add(id);
  else userPaused.delete(id);
  store.savePausedDownloads([...userPaused]);
}

/** A file much smaller than expected means the server sent an error page or the transfer was cut. */
function looksComplete(model: Model): boolean {
  const size = fileSizeMB(model);
  if (!size) return false;
  return !model.sizeMB || size >= model.sizeMB * 0.95;
}

async function finish(model: Model) {
  tasks.delete(model.id);
  samples.delete(model.id);
  restarted.delete(model.id);
  setUserPaused(model.id, false);
  if (looksComplete(model)) {
    await AsyncStorage.setItem(doneKey(model), '1');
    listener(model.id, null, true);
  } else {
    try {
      const file = modelFile(model);
      if (file.exists) file.delete();
    } catch {
      // Nothing to clean up.
    }
    listener(model.id, {
      status: 'failed', loaded: 0, total: model.sizeMB * 1e6, speed: 0,
      error: 'The download was incomplete. Try again.',
    }, false);
  }
}

function attach(model: Model, task: DownloadTask) {
  tasks.set(model.id, task);
  task
    .progress(({ bytesDownloaded, bytesTotal }) => {
      listener(model.id, {
        status: 'downloading',
        loaded: bytesDownloaded,
        total: bytesTotal > 0 ? bytesTotal : model.sizeMB * 1e6,
        speed: speedOf(model.id, bytesDownloaded),
      }, false);
    })
    .done(() => {
      completeHandler(task.id);
      finish(model);
    })
    .error(({ error }) => {
      completeHandler(task.id);
      tasks.delete(model.id);
      samples.delete(model.id);
      const text = String(error);
      // A paused download remembers a signed link, and those stop working after
      // a while. The server then refuses it. Start again from the real address.
      if (/forbidden|expired|\b40[13]\b/i.test(text) && !restarted.has(model.id)) {
        restarted.add(model.id);
        task.stop().catch(() => {}).finally(() => startDownload(model, true));
        return;
      }
      listener(model.id, {
        status: 'failed', loaded: task.bytesDownloaded, total: totalOf(model, task), speed: 0,
        error: friendlyError(text),
      }, false);
    });
}

function friendlyError(error: string): string {
  if (/offline|internet|network|connection|timed out/i.test(error)) {
    return 'The connection dropped. Tap Retry when you are back online.';
  }
  if (/space|disk|storage/i.test(error)) return 'There is not enough free storage.';
  if (/forbidden|expired|\b40[13]\b/i.test(error)) return 'The download link expired. Tap Retry.';
  if (/not found|\b404\b/i.test(error)) return 'The file is no longer at that address.';
  return error.replace(/^Error:\s*/, '').slice(0, 140);
}

/**
 * Call once at start. Picks up downloads that carried on while the app was
 * closed, and restarts any that iOS stopped (an app update does that) unless
 * the user had paused them.
 */
export async function restoreDownloads(models: Model[], onChange: Listener) {
  listener = onChange;
  setConfig({ progressInterval: 500 });
  userPaused = new Set(await store.pausedDownloads());
  const existing = await getExistingDownloadTasks().catch(() => [] as DownloadTask[]);
  for (const task of existing) {
    const model = models.find((m) => m.id === task.id);
    if (!model) continue;
    if (task.state === 'DONE') {
      completeHandler(task.id);
      await finish(model);
      continue;
    }
    attach(model, task);
    const paused = task.state === 'PAUSED';
    const resume = paused && !userPaused.has(model.id);
    if (resume) task.resume().catch(() => {});
    listener(model.id, {
      status: task.state === 'FAILED' ? 'failed' : paused && !resume ? 'paused' : 'downloading',
      loaded: task.bytesDownloaded,
      total: totalOf(model, task),
      speed: 0,
    }, false);
  }
}

export function startDownload(model: Model, automatic = false) {
  setUserPaused(model.id, false);
  if (!automatic) restarted.delete(model.id);
  const existing = tasks.get(model.id);
  if (existing) {
    existing.resume().catch(() => {});
    listener(model.id, {
      status: 'downloading', loaded: existing.bytesDownloaded, total: totalOf(model, existing), speed: 0,
    }, false);
    return;
  }
  const task = createDownloadTask({
    id: model.id,
    url: model.url,
    destination: `${directories.documents}/${model.file}`,
    metadata: { notificationTitle: model.name },
  });
  attach(model, task);
  task.start();
  listener(model.id, { status: 'downloading', loaded: 0, total: model.sizeMB * 1e6, speed: 0 }, false);
}

export async function pauseDownload(model: Model) {
  const task = tasks.get(model.id);
  if (!task) return;
  setUserPaused(model.id, true);
  samples.delete(model.id);
  await task.pause().catch(() => {});
  listener(model.id, {
    status: 'paused', loaded: task.bytesDownloaded, total: totalOf(model, task), speed: 0,
  }, false);
}

export async function deleteModel(model: Model) {
  const task = tasks.get(model.id);
  if (task) {
    await task.stop().catch(() => {});
    tasks.delete(model.id);
  }
  samples.delete(model.id);
  restarted.delete(model.id);
  setUserPaused(model.id, false);
  await AsyncStorage.removeItem(doneKey(model));
  try {
    const file = modelFile(model);
    if (file.exists) file.delete();
  } catch {
    // Already gone.
  }
  listener(model.id, null, false);
}
