// Photos attached to messages. They are copied into the app's own storage so
// a chat still shows them later.

import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

const FOLDER = 'images';

/** Lets the user choose a photo. Returns where it is, or null if they cancelled. */
export async function pickImage(): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
  return result.canceled ? null : result.assets[0]?.uri ?? null;
}

/**
 * Copies a picked photo into the app's storage and returns the name to keep
 * with the message. Only the name is stored, because iOS moves the app's
 * folder when the app is updated.
 */
export async function keepImage(uri: string): Promise<string> {
  if (Platform.OS === 'web') return uri;
  try {
    new Directory(Paths.document, FOLDER).create({ idempotent: true, intermediates: true });
    const extension = uri.match(/\.(jpe?g|png|heic|webp)(?:$|\?)/i)?.[1]?.toLowerCase() ?? 'jpg';
    const name = `${FOLDER}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}.${extension}`;
    await new File(uri).copy(new File(Paths.document, name));
    return name;
  } catch {
    // Could not copy: fall back to the picker's own temporary file.
    return uri;
  }
}

/** Where a message's photo is right now. */
export function imageUri(image: string): string {
  if (/^(file|blob|data|https?):/.test(image)) return image;
  return new File(Paths.document, image).uri;
}

export function deleteImages(images: (string | undefined)[]) {
  if (Platform.OS === 'web') return;
  for (const image of images) {
    if (!image || /^(file|blob|data|https?):/.test(image)) continue;
    try {
      const file = new File(Paths.document, image);
      if (file.exists) file.delete();
    } catch {
      // Already gone.
    }
  }
}

export function deleteAllImages() {
  if (Platform.OS === 'web') return;
  try {
    const folder = new Directory(Paths.document, FOLDER);
    if (folder.exists) folder.delete();
  } catch {
    // Nothing to remove.
  }
}
