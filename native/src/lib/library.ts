// The offline library: reference material kept on the phone that the model
// can be given when "Look up" is on. It works like a web search that never
// leaves the device.
//
// A source (Wikipedia, or a text file of your own) is cut into passages and
// put in a full-text index. Each source has its own database file, so removing
// one is just deleting that file.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, FileMode, Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { parquetMetadataAsync, parquetRead } from 'hyparquet/src/index.js';
import { best, chunk, LIBRARY_SCHEMA, retrieve, type Passage, type Query } from './retrieval';
import { SOURCES, type Source } from './sources';

export { SOURCES, sourceDownload, sourceForDownload, type Source } from './sources';

export type SourceState = {
  status: 'preparing' | 'ready' | 'failed';
  /** 0 to 1 while the index is being built. */
  progress: number;
  passages: number;
  error?: string;
};

export type LibraryFile = { name: string; passages: number };

/** What is saved about a source between launches. */
type Saved = { groups: number; passages: number; ready: boolean };

type Listener = (id: string, state: SourceState | null) => void;

const FILES_DB = 'library-files.db';
const ROWS_PER_INSERT = 50;

let listener: Listener = () => {};
const databases = new Map<string, Promise<SQLite.SQLiteDatabase>>();
/** Databases that have something to search. */
const searchable = new Set<string>();
const preparing = new Set<string>();

const dbName = (source: Source) => `library-${source.id}.db`;
const savedKey = (id: string) => `library:${id}`;

function open(name: string): Promise<SQLite.SQLiteDatabase> {
  let db = databases.get(name);
  if (!db) {
    db = (async () => {
      const opened = await SQLite.openDatabaseAsync(name);
      await opened.execAsync(`PRAGMA journal_mode = WAL; ${LIBRARY_SCHEMA}`);
      return opened;
    })();
    databases.set(name, db);
  }
  return db;
}

async function drop(name: string) {
  searchable.delete(name);
  const db = databases.get(name);
  databases.delete(name);
  if (db) await (await db).closeAsync().catch(() => {});
  await SQLite.deleteDatabaseAsync(name).catch(() => {});
}

async function readSaved(id: string): Promise<Saved | null> {
  try {
    const raw = await AsyncStorage.getItem(savedKey(id));
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

/** Writes passages to an index, many rows to a statement, which is far quicker than one at a time. */
async function insert(db: SQLite.SQLiteDatabase, rows: Passage[]) {
  for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
    const batch = rows.slice(i, i + ROWS_PER_INSERT);
    await db.runAsync(
      `INSERT INTO passages (title, body, source, pos) VALUES ${batch.map(() => '(?, ?, ?, ?)').join(', ')}`,
      batch.flatMap((p) => [p.title, p.body, p.source, p.pos]),
    );
  }
}

/** Lets the Parquet reader pull any part of a file on the phone without loading all of it. */
function reader(file: File) {
  const handle = file.open(FileMode.ReadOnly);
  const size = file.size ?? 0;
  // The handle has one position, so reads take turns.
  let turn: Promise<unknown> = Promise.resolve();
  return {
    byteLength: size,
    slice(start: number, end = size): Promise<ArrayBuffer> {
      const read = turn.then(async () => {
        handle.offset = start;
        const bytes = await handle.readBytes(end - start);
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      });
      turn = read.catch(() => {});
      return read;
    },
    close: () => handle.close(),
  };
}

// ---------- Wikipedia and other downloaded sources ----------

/**
 * A title as it should read: one line, without the numbering some sources add
 * ("How to Tie a Knot2") or the words every title in a source starts with.
 */
function tidyTitle(title: string, source: Source): string {
  const clean = title.replace(/\s+/g, ' ').trim().replace(/(?<=[a-z])\d+$/, '');
  const start = source.titlesStartWith;
  return start && clean.toLowerCase().startsWith(start.toLowerCase()) ? clean.slice(start.length).trim() : clean;
}

/**
 * Builds the index for a downloaded source. The file holds its articles in
 * groups of a thousand; each group is indexed and recorded before the next,
 * so if the app is closed part-way it carries on from where it stopped.
 */
export async function prepare(source: Source) {
  if (preparing.has(source.id)) return;
  preparing.add(source.id);
  const name = dbName(source);
  let saved = (await readSaved(source.id)) ?? { groups: 0, passages: 0, ready: false };
  const report = (state: SourceState) => listener(source.id, state);
  const file = new File(Paths.document, source.file);
  let input: ReturnType<typeof reader> | null = null;
  try {
    if (saved.groups === 0) await drop(name);
    const db = await open(name);
    input = reader(file);
    const metadata = await parquetMetadataAsync(input);
    const groups = metadata.row_groups;
    let rowStart = 0;
    for (let g = 0; g < groups.length; g++) {
      const count = Number(groups[g].num_rows);
      if (g >= saved.groups) {
        const { title, text } = source.columns;
        const entries = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
          parquetRead({
            file: input!, metadata, rowStart, rowEnd: rowStart + count,
            columns: [title, text], rowFormat: 'object',
            onComplete: (rows) => resolve(rows as Record<string, unknown>[]),
          }).catch(reject);
        });
        const rows: Passage[] = [];
        for (const entry of entries) {
          const name = tidyTitle(String(entry[title] ?? ''), source);
          if (!name) continue;
          chunk(String(entry[text] ?? '')).forEach((body, pos) => rows.push({ title: name, body, source: source.id, pos }));
        }
        await db.withTransactionAsync(() => insert(db, rows));
        saved = { groups: g + 1, passages: saved.passages + rows.length, ready: false };
        await AsyncStorage.setItem(savedKey(source.id), JSON.stringify(saved));
      }
      rowStart += count;
      report({ status: 'preparing', progress: (g + 1) / groups.length, passages: saved.passages });
    }
    saved = { ...saved, ready: true };
    await AsyncStorage.setItem(savedKey(source.id), JSON.stringify(saved));
    input.close();
    input = null;
    // The index is all that is needed from here on.
    try {
      if (file.exists) file.delete();
    } catch {
      // Left in place; it only costs space.
    }
    searchable.add(name);
    report({ status: 'ready', progress: 1, passages: saved.passages });
  } catch (e) {
    input?.close();
    report({
      status: 'failed', progress: 0, passages: saved.passages,
      error: `Could not prepare ${source.name}. ${String((e as Error)?.message ?? e)}`.slice(0, 160),
    });
  }
  preparing.delete(source.id);
}

export async function removeSource(source: Source) {
  await drop(dbName(source));
  await AsyncStorage.removeItem(savedKey(source.id)).catch(() => {});
  listener(source.id, null);
}

// ---------- your own files ----------

export async function libraryFiles(): Promise<LibraryFile[]> {
  try {
    const raw = await AsyncStorage.getItem(savedKey('files'));
    return raw ? (JSON.parse(raw) as LibraryFile[]) : [];
  } catch {
    return [];
  }
}

/** Adds a text to the library under a name. Returns the new list of files. */
export async function addText(name: string, text: string): Promise<LibraryFile[]> {
  const db = await open(FILES_DB);
  const rows = chunk(text).map((body, pos) => ({ title: name, body, source: name, pos }));
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM passages WHERE source = ?', name);
    await insert(db, rows);
  });
  const files = [...(await libraryFiles()).filter((f) => f.name !== name), { name, passages: rows.length }];
  await AsyncStorage.setItem(savedKey('files'), JSON.stringify(files));
  if (rows.length) searchable.add(FILES_DB);
  return files;
}

export async function removeText(name: string): Promise<LibraryFile[]> {
  const db = await open(FILES_DB);
  await db.runAsync('DELETE FROM passages WHERE source = ?', name);
  const files = (await libraryFiles()).filter((f) => f.name !== name);
  await AsyncStorage.setItem(savedKey('files'), JSON.stringify(files));
  if (!files.length) searchable.delete(FILES_DB);
  return files;
}

// ---------- starting up, and looking things up ----------

/**
 * Call once at start. Reports what is in the library and carries on with any
 * index that was still being built.
 */
export async function restoreLibrary(onChange: Listener, downloaded: (source: Source) => boolean) {
  listener = onChange;
  for (const source of SOURCES) {
    const saved = await readSaved(source.id);
    if (saved?.ready) {
      searchable.add(dbName(source));
      listener(source.id, { status: 'ready', progress: 1, passages: saved.passages });
    } else if (downloaded(source)) {
      prepare(source);
    }
  }
  if ((await libraryFiles()).length) searchable.add(FILES_DB);
}

export const libraryReady = () => searchable.size > 0;

/** Finds the passages in the library most likely to answer a question. */
export async function lookup(question: string, limit = 3): Promise<Passage[]> {
  const found: Passage[] = [];
  // Your own files are searched first, so that between equal finds theirs win.
  for (const name of [...searchable].sort((x, y) => Number(y === FILES_DB) - Number(x === FILES_DB))) {
    try {
      const db = await open(name);
      const query: Query = (sql, params) => db.getAllAsync(sql, params);
      const entriesOnly = SOURCES.some((source) => dbName(source) === name && source.entriesOnly);
      found.push(...(await retrieve(query, question, limit, { entriesOnly })));
    } catch {
      // A source that cannot be read is skipped.
    }
  }
  return best(found, limit);
}
