// A stand-in for downloads when previewing the interface in a browser. It
// pretends to download so the progress and states can be seen. The real
// downloads are in downloads.ts.

import type { Model } from './models';

export type DownloadState = {
  status: 'downloading' | 'paused' | 'failed';
  loaded: number;
  total: number;
  speed: number;
  error?: string;
};

type Listener = (modelId: string, state: DownloadState | null, done: boolean) => void;

let listener: Listener = () => {};
const done = new Set<string>();
const progress = new Map<string, number>();
const timers = new Map<string, ReturnType<typeof setInterval>>();

export const modelUri = (model: Model) => model.file;
export const fileSizeMB = (model: Model) => (done.has(model.id) ? model.sizeMB : 0);
export const isDownloaded = async (model: Model) => done.has(model.id);

export async function restoreDownloads(_models: Model[], onChange: Listener) {
  listener = onChange;
}

export function startDownload(model: Model) {
  const total = (model.sizeMB || 800) * 1e6;
  const speed = total / 8;
  clearInterval(timers.get(model.id));
  timers.set(model.id, setInterval(() => {
    const loaded = Math.min(total, (progress.get(model.id) ?? 0) + speed / 4);
    progress.set(model.id, loaded);
    if (loaded >= total) {
      clearInterval(timers.get(model.id));
      progress.delete(model.id);
      done.add(model.id);
      listener(model.id, null, true);
    } else {
      listener(model.id, { status: 'downloading', loaded, total, speed }, false);
    }
  }, 250));
  listener(model.id, { status: 'downloading', loaded: progress.get(model.id) ?? 0, total, speed: 0 }, false);
}

export async function pauseDownload(model: Model) {
  clearInterval(timers.get(model.id));
  listener(model.id, {
    status: 'paused', loaded: progress.get(model.id) ?? 0, total: (model.sizeMB || 800) * 1e6, speed: 0,
  }, false);
}

export async function deleteModel(model: Model) {
  clearInterval(timers.get(model.id));
  progress.delete(model.id);
  done.delete(model.id);
  listener(model.id, null, false);
}
