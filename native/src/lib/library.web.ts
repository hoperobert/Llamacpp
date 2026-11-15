// Stand-in for the browser preview, where there is no database or file
// download. It holds a few passages so the lookup can be seen working. The
// real library is in library.ts.

import type { Model } from './models';
import type { Passage } from './retrieval';

export type Source = { id: string; name: string; note: string; sizeMB: number; diskMB: number; file: string; url: string };
export type SourceState = { status: 'preparing' | 'ready' | 'failed'; progress: number; passages: number; error?: string };
export type LibraryFile = { name: string; passages: number };
type Listener = (id: string, state: SourceState | null) => void;

export const SOURCES: Source[] = [
  { id: 'wiki-simple', name: 'Wikipedia', note: 'Simple English · 242,000 articles', sizeMB: 157, diskMB: 500, file: 'wikipedia-simple.parquet', url: '' },
];

const SAMPLE: Passage[] = [
  { title: 'Vaccine', body: 'A vaccine is a biological preparation. It is given to prevent a specific infectious disease.', source: 'wiki-simple', pos: 0 },
  { title: 'Immune system', body: 'The immune system is the set of tissues which work together to resist infections.', source: 'wiki-simple', pos: 0 },
];

let listener: Listener = () => {};
let ready = false;
let files: LibraryFile[] = [];

export const sourceDownload = (source: Source): Model => ({
  id: `library-${source.id}`, name: source.name, note: source.note, sizeMB: source.sizeMB,
  file: source.file, url: source.url, group: 'custom',
});
export const sourceForDownload = (downloadId: string) => SOURCES.find((s) => `library-${s.id}` === downloadId);

export async function prepare(source: Source) {
  for (let i = 1; i <= 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    listener(source.id, { status: 'preparing', progress: i / 10, passages: i * 46174 });
  }
  ready = true;
  listener(source.id, { status: 'ready', progress: 1, passages: 461741 });
}
export async function removeSource(source: Source) { ready = false; listener(source.id, null); }
export const libraryFiles = async () => files;
export async function addText(name: string, text: string) {
  files = [...files.filter((f) => f.name !== name), { name, passages: Math.ceil(text.length / 900) }];
  return files;
}
export async function removeText(name: string) { files = files.filter((f) => f.name !== name); return files; }
export async function restoreLibrary(onChange: Listener) { listener = onChange; }
export const libraryReady = () => ready || files.length > 0;
export const lookup = async (): Promise<Passage[]> => (ready ? SAMPLE : []);
