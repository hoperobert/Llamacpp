// Model downloads that keep going in the background and never start over.
//
// A model is fetched in pieces. Each piece is its own small download handed to
// iOS (a background URL session), so pieces carry on while the app is in the
// background, the phone is locked, or the app has been closed. A finished
// piece is a file on disk: losing the connection, pausing, restarting the
// phone or updating the app can only ever cost the piece that was in flight.
// When every piece has arrived they are joined into the model file.
//
// Each piece asks the real address for its own byte range, so it always gets
// a fresh link. Nothing depends on a link that was handed out earlier.

import {
  completeHandler,
  createDownloadTask,
  directories,
  getExistingDownloadTasks,
  setConfig,
  type DownloadTask,
} from '@kesha-antonov/react-native-background-downloader';
import { File, FileMode, Paths } from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Model } from './models';
import { store } from './storage';

export type DownloadState = {
  status: 'downloading' | 'paused' | 'failed' | 'finishing';
  loaded: number;
  total: number;
  /** Bytes per second, averaged over the last few seconds. 0 when unknown. */
  speed: number;
  error?: string;
};

type Listener = (modelId: string, state: DownloadState | null, done: boolean) => void;

/** How a model's download is cut up. Saved, so it is the same after a restart. */
type Plan = {
  /** Size of the whole file in bytes. 0 when the server would not say. */
  total: number;
  /** Size of each piece in bytes. */
  piece: number;
  count: number;
  /** False when the server cannot send byte ranges: then there is one piece, the whole file. */
  ranged: boolean;
  /** How many pieces have already been joined into the model file. */
  joined: number;
};

const PIECE_BYTES = 64 * 1024 * 1024;
const COPY_BYTES = 8 * 1024 * 1024;
const MAX_TRIES = 5;

let listener: Listener = () => {};
let userPaused = new Set<string>();
const plans = new Map<string, Plan>();
const models = new Map<string, Model>();
/** Pieces being fetched right now, by `${model id}#${piece number}`. */
const live = new Map<string, DownloadTask>();
const tries = new Map<string, number>();
const failed = new Map<string, string>();
const joining = new Set<string>();
const starting = new Set<string>();
const samples = new Map<string, { at: number; loaded: number; speed: number }>();

const doneKey = (model: Model) => `downloaded:${model.id}`;
const planKey = (id: string) => `plan:${id}`;
const pieceId = (model: Model, index: number) => `${model.id}#${index}`;
const pieceName = (model: Model, index: number) => `${model.file}.part${index}`;
const modelFile = (model: Model) => new File(Paths.document, model.file);
const pieceFile = (model: Model, index: number) => new File(Paths.document, pieceName(model, index));
const joinFile = (model: Model) => new File(Paths.document, `${model.file}.joining`);

/** The path to hand to the engine. */
export const modelUri = (model: Model) => modelFile(model).uri;

const sizeOf = (file: File): number => {
  try {
    return file.exists ? file.size ?? 0 : 0;
  } catch {
    return 0;
  }
};

const remove = (file: File) => {
  try {
    if (file.exists) file.delete();
  } catch {
    // Already gone.
  }
};

/** Size of the downloaded file in MB, or 0 if it is not there. */
export const fileSizeMB = (model: Model): number => Math.round(sizeOf(modelFile(model)) / 1e6);

export async function isDownloaded(model: Model): Promise<boolean> {
  if (!(await AsyncStorage.getItem(doneKey(model)))) return false;
  return sizeOf(modelFile(model)) > 0;
}

// ---------- the plan ----------

const savePlan = (id: string, plan: Plan) => {
  plans.set(id, plan);
  return AsyncStorage.setItem(planKey(id), JSON.stringify(plan)).catch(() => {});
};

const dropPlan = (id: string) => {
  plans.delete(id);
  return AsyncStorage.removeItem(planKey(id)).catch(() => {});
};

/** How many bytes piece `index` should be. 0 when unknown. */
function pieceBytes(plan: Plan, index: number): number {
  if (!plan.ranged) return plan.total;
  return index < plan.count - 1 ? plan.piece : plan.total - plan.piece * (plan.count - 1);
}

/** True when a piece is fully on disk. */
function pieceReady(model: Model, plan: Plan, index: number): boolean {
  if (index < plan.joined) return true;
  if (live.has(pieceId(model, index))) return false;
  const size = sizeOf(pieceFile(model, index));
  const expected = pieceBytes(plan, index);
  return expected ? size === expected : size > 0;
}

/**
 * Asks the server how big the file is and whether it can send it in ranges.
 * One byte is requested, which also proves the address works.
 */
async function makePlan(model: Model): Promise<Plan> {
  const response = await fetch(model.url, { headers: { Range: 'bytes=0-0' } });
  if (!response.ok) throw new Error(`The server answered ${response.status}.`);
  const total = Number(response.headers.get('content-range')?.match(/\/(\d+)\s*$/)?.[1] ?? 0);
  if (response.status === 206 && total > 0) {
    return { total, piece: PIECE_BYTES, count: Math.ceil(total / PIECE_BYTES), ranged: true, joined: 0 };
  }
  // No ranges: fetch it as a single piece.
  return { total: 0, piece: 0, count: 1, ranged: false, joined: 0 };
}

// ---------- progress ----------

function loadedBytes(model: Model, plan: Plan): number {
  let loaded = 0;
  for (let i = 0; i < plan.count; i++) {
    const task = live.get(pieceId(model, i));
    if (i < plan.joined) loaded += pieceBytes(plan, i);
    else if (task) loaded += Math.max(0, task.bytesDownloaded);
    else if (pieceReady(model, plan, i)) loaded += sizeOf(pieceFile(model, i));
  }
  return loaded;
}

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

const isLive = (model: Model) => [...live.keys()].some((key) => key.startsWith(`${model.id}#`));

/** Tells the app where a download has got to. */
function report(model: Model) {
  const plan = plans.get(model.id);
  const total = plan?.total || model.sizeMB * 1e6;
  const loaded = plan ? loadedBytes(model, plan) : 0;
  const error = failed.get(model.id);
  const status: DownloadState['status'] =
    joining.has(model.id) ? 'finishing'
    : userPaused.has(model.id) ? 'paused'
    : error && !isLive(model) && !starting.has(model.id) ? 'failed'
    : 'downloading';
  listener(model.id, {
    status,
    loaded,
    total: Math.max(total, loaded),
    speed: status === 'downloading' ? speedOf(model.id, loaded) : 0,
    error: status === 'failed' ? error : undefined,
  }, false);
}

function setUserPaused(id: string, paused: boolean) {
  if (paused) userPaused.add(id);
  else userPaused.delete(id);
  store.savePausedDownloads([...userPaused]);
}

function friendlyError(error: string): string {
  if (/offline|internet|network|connection|timed out/i.test(error)) {
    return 'The connection dropped. Tap Retry to carry on from where it stopped.';
  }
  if (/space|disk|storage/i.test(error)) return 'There is not enough free storage.';
  if (/not found|\b404\b/i.test(error)) return 'The file is no longer at that address.';
  return error.replace(/^Error:\s*/, '').slice(0, 140);
}

// ---------- fetching pieces ----------

function watch(model: Model, plan: Plan, index: number, task: DownloadTask) {
  const key = pieceId(model, index);
  live.set(key, task);
  task
    .progress(() => report(model))
    .done(() => {
      completeHandler(task.id);
      live.delete(key);
      const expected = pieceBytes(plan, index);
      const size = sizeOf(pieceFile(model, index));
      if (expected ? size === expected : size > 0) {
        tries.delete(key);
        report(model);
        finishIfComplete(model);
      } else {
        // The wrong amount arrived (an error page, or a cut transfer). Fetch this piece again.
        retry(model, plan, index, 'A piece of the download was incomplete.');
      }
    })
    .error(({ error }) => {
      completeHandler(task.id);
      live.delete(key);
      retry(model, plan, index, friendlyError(String(error)));
    });
}

function fetchPiece(model: Model, plan: Plan, index: number) {
  remove(pieceFile(model, index));
  const start = index * plan.piece;
  const task = createDownloadTask({
    id: pieceId(model, index),
    url: model.url,
    destination: `${directories.documents}/${pieceName(model, index)}`,
    ...(plan.ranged ? { headers: { Range: `bytes=${start}-${start + pieceBytes(plan, index) - 1}` } } : {}),
    metadata: { notificationTitle: model.name },
  });
  watch(model, plan, index, task);
  task.start();
}

/** Tries a piece again after a pause that grows each time, a few times, before giving up on it. */
function retry(model: Model, plan: Plan, index: number, reason: string) {
  const key = pieceId(model, index);
  const count = (tries.get(key) ?? 0) + 1;
  tries.set(key, count);
  if (count > MAX_TRIES) {
    failed.set(model.id, reason);
    report(model);
    return;
  }
  report(model);
  setTimeout(() => {
    const current = plans.get(model.id);
    if (current !== plan || userPaused.has(model.id) || live.has(key) || pieceReady(model, plan, index)) return;
    fetchPiece(model, plan, index);
    report(model);
  }, Math.min(30000, 1500 * count));
}

/** Starts every piece that is neither on disk nor already being fetched. */
function fetchMissing(model: Model, plan: Plan) {
  for (let i = plan.joined; i < plan.count; i++) {
    if (!live.has(pieceId(model, i)) && !pieceReady(model, plan, i)) fetchPiece(model, plan, i);
  }
}

// ---------- joining the pieces ----------

async function finishIfComplete(model: Model) {
  const plan = plans.get(model.id);
  if (!plan || joining.has(model.id)) return;
  for (let i = plan.joined; i < plan.count; i++) if (!pieceReady(model, plan, i)) return;

  joining.add(model.id);
  report(model);
  try {
    if (plan.count === 1) {
      remove(modelFile(model));
      await pieceFile(model, 0).move(modelFile(model));
    } else {
      await join(model, plan);
    }
    const size = sizeOf(modelFile(model));
    if (!size || (plan.total && size !== plan.total)) throw new Error('The joined file is the wrong size.');
    await AsyncStorage.setItem(doneKey(model), '1');
    await dropPlan(model.id);
    joining.delete(model.id);
    samples.delete(model.id);
    failed.delete(model.id);
    setUserPaused(model.id, false);
    listener(model.id, null, true);
  } catch (e) {
    joining.delete(model.id);
    failed.set(model.id, `Could not finish the download. ${String((e as Error)?.message ?? e)}`);
    report(model);
  }
}

/**
 * Copies each piece onto the end of one file, removing pieces as it goes so
 * the phone never needs room for two copies. How far it has got is saved after
 * every piece, so being interrupted here loses nothing either.
 */
async function join(model: Model, start: Plan) {
  let plan = start;
  const target = joinFile(model);
  if (!target.exists) target.create();
  const out = target.open(FileMode.ReadWrite);
  try {
    for (let i = plan.joined; i < plan.count; i++) {
      const source = pieceFile(model, i);
      const input = source.open(FileMode.ReadOnly);
      try {
        // Always write a piece at its own place, so a piece copied twice lands in the same spot.
        out.offset = i * plan.piece;
        for (;;) {
          const bytes = await input.readBytes(COPY_BYTES);
          if (!bytes.length) break;
          await out.writeBytes(bytes);
        }
      } finally {
        input.close();
      }
      plan = { ...plan, joined: i + 1 };
      await savePlan(model.id, plan);
      remove(source);
      report(model);
    }
  } finally {
    out.close();
  }
  remove(modelFile(model));
  await target.move(modelFile(model));
}

// ---------- what the app calls ----------

/**
 * Call once at start. Picks up pieces that carried on while the app was
 * closed, and restarts whatever is still missing unless the user had paused.
 */
export async function restoreDownloads(all: Model[], onChange: Listener) {
  listener = onChange;
  setConfig({ progressInterval: 500 });
  userPaused = new Set(await store.pausedDownloads());
  for (const model of all) {
    models.set(model.id, model);
    const saved = await AsyncStorage.getItem(planKey(model.id)).catch(() => null);
    if (saved) {
      try {
        plans.set(model.id, JSON.parse(saved) as Plan);
      } catch {
        // An unreadable plan is dropped; the download starts afresh when asked for.
      }
    }
  }

  const existing = await getExistingDownloadTasks().catch(() => [] as DownloadTask[]);
  for (const task of existing) {
    const [modelId, piece] = task.id.split('#');
    const model = models.get(modelId);
    const plan = model && plans.get(modelId);
    const index = Number(piece);
    const running = task.state === 'DOWNLOADING' || task.state === 'PENDING';
    if (model && plan && piece !== undefined && index < plan.count && running && !userPaused.has(modelId)) {
      watch(model, plan, index, task);
    } else {
      // Finished, stale, or left over from an older version of the app: let it go.
      // Anything still needed is fetched again below, with a fresh link.
      if (task.state === 'DONE') completeHandler(task.id);
      else task.stop().catch(() => {});
    }
  }

  for (const [id, plan] of plans) {
    const model = models.get(id);
    if (!model) continue;
    if (userPaused.has(id)) {
      report(model);
    } else {
      fetchMissing(model, plan);
      report(model);
      finishIfComplete(model);
    }
  }
}

/** Starts a download, or carries on with one that was paused or had failed. */
export async function startDownload(model: Model) {
  models.set(model.id, model);
  setUserPaused(model.id, false);
  failed.delete(model.id);
  for (const key of [...tries.keys()]) if (key.startsWith(`${model.id}#`)) tries.delete(key);

  let plan = plans.get(model.id);
  if (!plan) {
    if (starting.has(model.id)) return;
    starting.add(model.id);
    report(model);
    try {
      plan = await makePlan(model);
      await savePlan(model.id, plan);
    } catch (e) {
      failed.set(model.id, friendlyError(String((e as Error)?.message ?? e)));
    }
    starting.delete(model.id);
    if (!plan || userPaused.has(model.id)) {
      report(model);
      return;
    }
  }
  fetchMissing(model, plan);
  report(model);
  finishIfComplete(model);
}

/**
 * Carries on with every download that stopped because of an error. Called when
 * the connection comes back and when the app is opened again.
 */
export function resumeFailedDownloads() {
  for (const id of [...failed.keys()]) {
    const model = models.get(id);
    if (model && plans.has(id) && !userPaused.has(id) && !isLive(model) && !joining.has(id)) startDownload(model);
  }
}

/** Pauses a download. Finished pieces stay; only the pieces in flight are given up. */
export async function pauseDownload(model: Model) {
  setUserPaused(model.id, true);
  samples.delete(model.id);
  await stopPieces(model);
  report(model);
}

async function stopPieces(model: Model) {
  const mine = [...live.entries()].filter(([key]) => key.startsWith(`${model.id}#`));
  for (const [key, task] of mine) {
    live.delete(key);
    await task.stop().catch(() => {});
    remove(pieceFile(model, Number(key.split('#')[1])));
  }
}

export async function deleteModel(model: Model) {
  const plan = plans.get(model.id);
  await stopPieces(model);
  if (plan) for (let i = 0; i < plan.count; i++) remove(pieceFile(model, i));
  remove(joinFile(model));
  remove(modelFile(model));
  await dropPlan(model.id);
  samples.delete(model.id);
  failed.delete(model.id);
  joining.delete(model.id);
  setUserPaused(model.id, false);
  await AsyncStorage.removeItem(doneKey(model));
  listener(model.id, null, false);
}
