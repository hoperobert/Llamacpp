// What the phone itself can tell or do with no signal: where it is (GPS needs
// no internet), which way it faces, how much battery is left, its torch, a loud
// alarm, its voice. Used by the Emergency screen, and by tools the model
// builds, which ask through `pocket.phone(...)`.

import * as Battery from 'expo-battery';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { alarm, screenBrightness, torch } from '../../modules/pocket-native';

/** Gives up on something that has not answered in time, with null. A fix indoors can take for ever. */
const within = <T>(ms: number, job: Promise<T>): Promise<T | null> =>
  Promise.race([job, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

export type Place = { latitude: number; longitude: number; accuracy: number | null; altitude: number | null; at: number };

/** Where the phone is, from GPS. Null if iOS has not allowed it or no fix could be had. */
export async function whereAmI(): Promise<Place | null> {
  try {
    const allowed = await Location.requestForegroundPermissionsAsync();
    if (!allowed.granted) return null;
    const found = (await within(20000, Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null)))
      ?? (await Location.getLastKnownPositionAsync().catch(() => null));
    if (!found) return null;
    const { latitude, longitude, accuracy, altitude } = found.coords;
    return { latitude, longitude, accuracy: accuracy ?? null, altitude: altitude ?? null, at: found.timestamp };
  } catch {
    return null;
  }
}

/** The direction the top of the phone points, in degrees from north. Null if it cannot be told. */
export async function heading(): Promise<number | null> {
  try {
    const allowed = await Location.requestForegroundPermissionsAsync();
    if (!allowed.granted) return null;
    const found = await within(4000, Location.getHeadingAsync());
    if (!found) return null;
    const degrees = found.trueHeading >= 0 ? found.trueHeading : found.magHeading;
    return degrees >= 0 ? degrees : null;
  } catch {
    return null;
  }
}

/** How full the battery is, 0 to 1, and whether the phone is saving power. */
export async function battery(): Promise<{ level: number | null; saving: boolean }> {
  const [level, saving] = await Promise.all([
    Battery.getBatteryLevelAsync().catch(() => -1),
    Battery.isLowPowerModeEnabledAsync().catch(() => false),
  ]);
  return { level: level >= 0 ? level : null, saving };
}

export { alarm, screenBrightness, torch };

/** Answers a tool that asked the phone for something. Anything not known is answered with null. */
export async function askPhone(what: string, arg: unknown): Promise<unknown> {
  switch (what) {
    case 'location': {
      const place = await whereAmI();
      return place && { latitude: place.latitude, longitude: place.longitude, accuracy: place.accuracy, altitude: place.altitude };
    }
    case 'heading': return heading();
    case 'battery': return (await battery()).level;
    case 'torch': return torch(Number(arg) > 0 ? Math.min(1, Number(arg)) : 0);
    case 'alarm': return alarm(!!arg);
    case 'speak':
      Speech.speak(String(arg ?? '').slice(0, 2000));
      return true;
    case 'vibrate':
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      return true;
    default: return null;
  }
}

/** Puts out whatever a tool or the Emergency screen left on. */
export function allOff() {
  torch(0);
  alarm(false);
  Speech.stop().catch(() => {});
}
