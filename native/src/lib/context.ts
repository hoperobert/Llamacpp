// How much context to give a model, so that it fits in this phone's memory.
//
// A loaded model takes memory for three things: the model itself (the size of
// its file), the context (what it has read so far, which grows with the
// context size), and working space. The context is the part that can be
// chosen. Too much and iOS closes the app; too little and long chats have to
// be summarised sooner.
//
// Nothing here touches the phone, so the tests use it as it is.

/** Context sizes that can be chosen, smallest first. */
export const CONTEXT_STEPS = [2048, 3072, 4096, 6144, 8192];

/** Used for a model whose file does not say: about what a 4B model needs. */
export const DEFAULT_KV_KB = 128;

/** Working space while a reply is written, and the app itself. */
const OVERHEAD_MB = 400;
/** Everything together may take this share of the phone's memory. */
const TOTAL_SHARE = 0.6;
/** The context alone may take this share. It is memory iOS can never reclaim while the model is loaded. */
const CONTEXT_SHARE = 0.07;

const numbers = (value: unknown): number[] => {
  if (typeof value === 'number') return [value];
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
  return (String(value ?? '').match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
};

/**
 * Memory the context takes per token, in KB, from the details stored in a
 * model's file. Every layer that pays attention keeps a key and a value for
 * each of its heads, at two bytes a number. Null when the file does not say.
 */
export function kvKBPerToken(info: Record<string, unknown>): number | null {
  const arch = String(info['general.architecture'] ?? '');
  const read = (key: string) => numbers(info[`${arch}.${key}`]);
  const layers = read('block_count')[0];
  const perLayer = read('attention.head_count_kv');
  const heads = read('attention.head_count')[0];
  if (!arch || !layers || !perLayer.length) return null;
  // Some models list the heads layer by layer, with none for layers that do not pay attention.
  const allHeads = perLayer.length > 1 ? perLayer.reduce((sum, n) => sum + n, 0) : perLayer[0] * layers;
  const width = read('embedding_length')[0];
  const key = read('attention.key_length')[0] ?? (width && heads ? width / heads : 0);
  const value = read('attention.value_length')[0] ?? key;
  const kb = (allHeads * (key + value) * 2) / 1024;
  return kb > 0 && Number.isFinite(kb) ? kb : null;
}

/** The context size the model was made for, if its file says. */
export function trainedContext(info: Record<string, unknown>): number | null {
  const arch = String(info['general.architecture'] ?? '');
  return numbers(info[`${arch}.context_length`])[0] ?? null;
}

/**
 * The largest context that fits. It never goes below the smallest size: a
 * model too big for even that is one the phone should not be loading.
 */
export function bestContext(model: {
  /** Size of the model file. */
  fileMB: number;
  /** Memory the context takes per token. */
  kvKB: number;
  /** Anything else loaded with it, such as what lets it look at photos. */
  extraMB?: number;
  /** Memory in the phone. Unknown is treated as a small phone. */
  ramMB: number | null;
  /** The size the model was made for. */
  trained?: number | null;
}): number {
  const ram = model.ramMB ?? 4096;
  const room = Math.min(
    ram * TOTAL_SHARE - model.fileMB - (model.extraMB ?? 0) - OVERHEAD_MB,
    ram * CONTEXT_SHARE,
  );
  const limit = model.trained || Infinity;
  const fits = CONTEXT_STEPS.filter((step) => step <= limit && (step * model.kvKB) / 1024 <= room);
  return fits.at(-1) ?? CONTEXT_STEPS[0];
}
