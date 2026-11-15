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
