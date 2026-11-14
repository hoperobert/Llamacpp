// Lets the app's logic run under plain Node: the phone-only modules are
// swapped for the stand-ins in ./mocks.
const here = new URL('./mocks/', import.meta.url);
const map = {
  'expo-sqlite': new URL('sqlite.mjs', here).href,
  '@react-native-async-storage/async-storage': new URL('storage.mjs', here).href,
  '@kesha-antonov/react-native-background-downloader': new URL('downloader.mjs', here).href,
  'expo-file-system': new URL('files.mjs', here).href,
};
export async function resolve(specifier, context, next) {
  if (map[specifier]) return { url: map[specifier], shortCircuit: true };
  // The app imports its own files without extensions.
  if (specifier.startsWith('./') && !/\.\w+$/.test(specifier) && context.parentURL?.includes('/src/')) {
    return next(`${specifier}.ts`, context);
  }
  return next(specifier, context);
}
