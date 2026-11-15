// Python's runtime on the phone: fetched once (about 13 MB), kept in the app's
// own storage, and handed to the web view that runs code from there. After the
// one download Python needs no internet.

import { Directory, File, Paths } from 'expo-file-system';
import { serveFolder } from '../../modules/pocket-native';
import { PYTHON_FILES, pythonPage, pythonUrl } from './runner';

const folder = () => new Directory(Paths.document, 'python');

/** True when every part of the runtime is on the phone and whole. */
export function pythonReady(): boolean {
  try {
    return PYTHON_FILES.every(({ name, bytes }) => {
      const file = new File(folder(), name);
      return file.exists && file.size === bytes;
    });
  } catch {
    return false;
  }
}

/** Fetches whatever part of the runtime is missing. `onProgress` is given how far along it is, 0 to 1. */
export async function installPython(onProgress: (fraction: number) => void): Promise<void> {
  folder().create({ idempotent: true, intermediates: true });
  const total = PYTHON_FILES.reduce((n, f) => n + f.bytes, 0);
  let have = 0;
  for (const { name, bytes } of PYTHON_FILES) {
    const file = new File(folder(), name);
    if (!(file.exists && file.size === bytes)) {
      if (file.exists) file.delete();
      await File.downloadFileAsync(pythonUrl(name), file);
      if (file.size !== bytes) {
        file.delete();
        throw new Error('The download did not arrive whole. Try again.');
      }
    }
    have += bytes;
    onProgress(have / total);
  }
}

export function removePython() {
  try {
    if (folder().exists) folder().delete();
  } catch {
    // Nothing to remove.
  }
}

/**
 * Where the web view loads the page that runs Python from. Null if the
 * runtime is not here, or this build of the app cannot hand files to a web view.
 */
export async function pythonAddress(): Promise<string | null> {
  if (!pythonReady()) return null;
  // Written each time, so that the page is always the one this version of the app expects.
  const page = new File(folder(), 'index.html');
  if (page.exists) page.delete();
  page.create();
  page.write(pythonPage());
  return serveFolder(folder().uri);
}
