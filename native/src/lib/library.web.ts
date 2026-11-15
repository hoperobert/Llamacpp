// Stand-in for the browser preview, where there is no database or file
// download. It holds a few passages so the lookup can be seen working. The
// real library is in library.ts.

import type { Passage } from './retrieval';
import type { Source } from './sources';

export { SOURCES, sourceDownload, sourceForDownload, type Source } from './sources';

export type SourceState = { status: 'preparing' | 'ready' | 'failed'; progress: number; passages: number; error?: string };
export type LibraryFile = { name: string; passages: number };
type Listener = (id: string, state: SourceState | null) => void;

const SAMPLE: Passage[] = [
  { title: 'Vaccine', body: 'A vaccine is a biological preparation. It is given to prevent a specific infectious disease.', source: 'wiki-simple', pos: 0 },
  { title: 'Immune system', body: 'The immune system is the set of tissues which work together to resist infections.', source: 'wiki-simple', pos: 0 },
];

let listener: Listener = () => {};
const ready = new Set<string>();
let files: LibraryFile[] = [];

export async function prepare(source: Source) {
  for (let i = 1; i <= 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    listener(source.id, { status: 'preparing', progress: i / 10, passages: i * 46174 });
  }
  ready.add(source.id);
  listener(source.id, { status: 'ready', progress: 1, passages: 461741 });
}
export async function removeSource(source: Source) { ready.delete(source.id); listener(source.id, null); }
export const libraryFiles = async () => files;
export async function addText(name: string, text: string) {
  files = [...files.filter((f) => f.name !== name), { name, passages: Math.ceil(text.length / 900) }];
  return files;
}
export async function removeText(name: string) { files = files.filter((f) => f.name !== name); return files; }
export async function restoreLibrary(onChange: Listener) { listener = onChange; }
export const libraryReady = () => ready.size > 0 || files.length > 0;
export const lookup = async (): Promise<Passage[]> => (ready.size ? SAMPLE : []);
