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
  type DownloadTask,
} from '@kesha-antonov/react-native-background-downloader';
import { File, Paths } from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Model } from './models';

export type DownloadState = {
  status: 'downloading' | 'paused' | 'failed';
  loaded: number;
  total: number;
  error?: string;
};

type Listener = (modelId: string, state: DownloadState | null, done: boolean) => void;

const tasks = new Map<string, DownloadTask>();
let listener: Listener = () => {};

const doneKey = (model: Model) => `downloaded:${model.id}`;
const modelFile = (model: Model) => new File(Paths.document, model.file);

/** The path to hand to the engine. */
export const modelUri = (model: Model) => modelFile(model).uri;

export async function isDownloaded(model: Model): Promise<boolean> {
  if (!(await AsyncStorage.getItem(doneKey(model)))) return false;
  return modelFile(model).exists;
}

function attach(model: Model, task: DownloadTask) {
  tasks.set(model.id, task);
  const total = () => task.bytesTotal > 0 ? task.bytesTotal : model.sizeMB * 1e6;
  task
    .progress(({ bytesDownloaded, bytesTotal }) => {
      listener(model.id, {
        status: 'downloading',
        loaded: bytesDownloaded,
        total: bytesTotal > 0 ? bytesTotal : model.sizeMB * 1e6,
      }, false);
    })
    .done(async () => {
      completeHandler(task.id);
      tasks.delete(model.id);
      await AsyncStorage.setItem(doneKey(model), '1');
      listener(model.id, null, true);
    })
    .error(({ error }) => {
      completeHandler(task.id);
      tasks.delete(model.id);
      listener(model.id, {
        status: 'failed', loaded: task.bytesDownloaded, total: total(), error: String(error),
      }, false);
    });
}

/** Call once at start: picks up downloads that carried on while the app was closed. */
export async function restoreDownloads(models: Model[], onChange: Listener) {
  listener = onChange;
  const existing = await getExistingDownloadTasks().catch(() => [] as DownloadTask[]);
  for (const task of existing) {
    const model = models.find((m) => m.id === task.id);
    if (!model) continue;
    if (task.state === 'DONE') {
      completeHandler(task.id);
      await AsyncStorage.setItem(doneKey(model), '1');
      listener(model.id, null, true);
      continue;
    }
    attach(model, task);
    listener(model.id, {
      status: task.state === 'PAUSED' ? 'paused' : task.state === 'FAILED' ? 'failed' : 'downloading',
      loaded: task.bytesDownloaded,
      total: task.bytesTotal > 0 ? task.bytesTotal : model.sizeMB * 1e6,
    }, false);
  }
}

export function startDownload(model: Model) {
  const existing = tasks.get(model.id);
  if (existing) {
    existing.resume().catch(() => {});
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
  listener(model.id, { status: 'downloading', loaded: 0, total: model.sizeMB * 1e6 }, false);
}

export async function pauseDownload(model: Model) {
  const task = tasks.get(model.id);
  if (!task) return;
  await task.pause().catch(() => {});
  listener(model.id, {
    status: 'paused',
    loaded: task.bytesDownloaded,
    total: task.bytesTotal > 0 ? task.bytesTotal : model.sizeMB * 1e6,
  }, false);
}

export async function deleteModel(model: Model) {
  const task = tasks.get(model.id);
  if (task) {
    await task.stop().catch(() => {});
    tasks.delete(model.id);
  }
  await AsyncStorage.removeItem(doneKey(model));
  try {
    const file = modelFile(model);
    if (file.exists) file.delete();
  } catch {
    // Already gone.
  }
  listener(model.id, null, false);
}
