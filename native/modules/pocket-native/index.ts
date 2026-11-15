// The few things Pocket LLM needs from iOS that no package offers. See
// ios/PocketNativeModule.swift. Everything here does nothing, quietly, where
// the module is missing: an older build, or the browser preview.

import { requireOptionalNativeModule } from 'expo';

type Native = {
  backgroundKind(): 'continued' | 'short';
  timeRemaining(): Promise<number>;
  begin(title: string, subtitle: string): Promise<'continued' | 'short' | 'none'>;
  progress(fraction: number): Promise<void>;
  end(success: boolean): Promise<void>;
  pdfText(uri: string): Promise<string>;
  imageText(uri: string): Promise<string>;
  torch(level: number): Promise<boolean>;
  brightness(level: number): Promise<number>;
  alarm(on: boolean): Promise<boolean>;
  serve(directory: string): Promise<number>;
  stopServing(): Promise<void>;
  addListener(event: 'onExpire', listener: () => void): { remove(): void };
};

const native = requireOptionalNativeModule<Native>('PocketNative');

export const hasNative = !!native;

/** Asks iOS for time to finish something after the app leaves the screen. */
export const beginBackgroundWork = (title: string, subtitle: string) =>
  native ? native.begin(title, subtitle).catch(() => 'none' as const) : Promise.resolve('none' as const);

export const backgroundProgress = (fraction: number) => { native?.progress(fraction).catch(() => {}); };

export const endBackgroundWork = (success = true) => { native?.end(success).catch(() => {}); };

export const backgroundTimeRemaining = () => (native ? native.timeRemaining().catch(() => 0) : Promise.resolve(0));

/** Called when iOS says the time is up. */
export const onBackgroundExpire = (listener: () => void) => native?.addListener('onExpire', listener) ?? { remove() {} };

/** The text of a PDF. Empty if there is none to read, or no way to read it here. */
export const pdfText = (uri: string) => (native ? native.pdfText(uri).catch(() => '') : Promise.resolve(''));

/** The text found in a picture: a page, a sign, a screenshot. Empty if there is none. */
export const imageText = (uri: string) => (native ? native.imageText(uri).catch(() => '') : Promise.resolve(''));

/** The torch: 0 is off, up to 1 for full. False where there is none. */
export const torch = (level: number) => (native?.torch ? native.torch(level).catch(() => false) : Promise.resolve(false));

/** Sets how bright the screen is, from 0 to 1, and gives back how bright it was. Below 0 only asks. */
export const screenBrightness = (level: number) => (native?.brightness ? native.brightness(level).catch(() => -1) : Promise.resolve(-1));

/** A loud tone to be found by. It sounds even with the ringer switched off. */
export const alarm = (on: boolean) => (native?.alarm ? native.alarm(on).catch(() => false) : Promise.resolve(false));

/** Hands out the files in a folder to the app's own web view. Gives the address to load them from, or null. */
export const serveFolder = async (directory: string) => {
  const port = native?.serve ? await native.serve(directory).catch(() => 0) : 0;
  return port ? `http://127.0.0.1:${port}/` : null;
};

export const stopServing = () => { native?.stopServing?.().catch(() => {}); };
