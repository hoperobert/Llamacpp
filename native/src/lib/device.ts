// What this iPhone can handle.

import * as Device from 'expo-device';
import { Paths } from 'expo-file-system';

/** Installed memory in MB, or null when the platform does not say. */
export const ramMB: number | null = Device.totalMemory ? Math.round(Device.totalMemory / 1048576) : null;

export const deviceName = Device.modelName ?? 'This device';

/** Free storage in MB, or null when unknown. */
export function freeDiskMB(): number | null {
  try {
    const bytes = Paths.availableDiskSpace;
    return bytes > 0 ? Math.round(bytes / 1e6) : null;
  } catch {
    return null;
  }
}
