// For an update sent to a build of the app made before it could use GPS, the
// battery, the torch or the alarm: none of them is there to ask.

import * as Speech from 'expo-speech';

export type Place = { latitude: number; longitude: number; accuracy: number | null; altitude: number | null; at: number };

export const whereAmI = async (): Promise<Place | null> => null;
export const heading = async (): Promise<number | null> => null;
export const battery = async (): Promise<{ level: number | null; saving: boolean }> => ({ level: null, saving: false });
export const torch = async (_level: number) => false;
export const alarm = async (_on: boolean) => false;
export const screenBrightness = async (_level: number) => -1;
export const askPhone = async (_what: string, _arg: unknown): Promise<unknown> => null;

export function allOff() {
  Speech.stop().catch(() => {});
}
