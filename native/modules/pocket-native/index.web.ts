// The browser preview's stand-in. It grants the short allowance, so that what
// the app does when it is left can be tried there. `pocketNative.expire()`
// plays the part of iOS saying the time is up.

const listeners = new Set<() => void>();
const calls: string[] = [];
(globalThis as { pocketNative?: object }).pocketNative = {
  calls,
  expire: () => listeners.forEach((listener) => listener()),
};

export const hasNative = true;
export const beginBackgroundWork = async (title: string, _subtitle: string) => {
  calls.push(`begin ${title}`);
  return 'short' as 'continued' | 'short' | 'none';
};
export const backgroundProgress = (_fraction: number) => {};
export const endBackgroundWork = (success = true) => { calls.push(`end ${success}`); };
export const backgroundTimeRemaining = async () => 25;
export const onBackgroundExpire = (listener: () => void) => {
  listeners.add(listener);
  return { remove() { listeners.delete(listener); } };
};
export const pdfText = async (_uri: string) => '';
export const imageText = async (_uri: string) => '';

// The browser has no torch or alarm. What was asked of them is kept, for checks.
export const torch = async (level: number) => { calls.push(`torch ${level}`); return true; };
export const screenBrightness = async (level: number) => { calls.push(`brightness ${level}`); return 0.5; };
export const alarm = async (on: boolean) => { calls.push(`alarm ${on}`); return true; };
export const serveFolder = async (_directory: string): Promise<string | null> => null;
export const stopServing = () => {};
