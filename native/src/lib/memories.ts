// Memories live in a SQLite database on the device.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import type { Memory } from './storage';

let opening: Promise<SQLite.SQLiteDatabase> | null = null;

function database(): Promise<SQLite.SQLiteDatabase> {
  opening ??= (async () => {
    const db = await SQLite.openDatabaseAsync('pocket.db');
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY NOT NULL,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    await importOlderMemories(db);
    return db;
  })();
  return opening;
}

/** Earlier versions kept memories in a settings-style store. Move them across once. */
async function importOlderMemories(db: SQLite.SQLiteDatabase) {
  const raw = await AsyncStorage.getItem('memories').catch(() => null);
  if (!raw) return;
  try {
    const old = JSON.parse(raw) as Memory[];
    const now = Date.now();
    await db.withTransactionAsync(async () => {
      for (let i = 0; i < old.length; i++) {
        await db.runAsync(
          'INSERT OR IGNORE INTO memories (id, text, created_at) VALUES (?, ?, ?)',
          old[i].id, old[i].text, now + i,
        );
      }
    });
  } catch {
    // Unreadable old data is left behind rather than blocking the app.
  }
  await AsyncStorage.removeItem('memories').catch(() => {});
}

export async function loadMemories(): Promise<Memory[]> {
  try {
    const db = await database();
    return await db.getAllAsync<Memory>('SELECT id, text FROM memories ORDER BY created_at, rowid');
  } catch {
    return [];
  }
}

export async function insertMemory(memory: Memory) {
  const db = await database();
  await db.runAsync(
    'INSERT OR REPLACE INTO memories (id, text, created_at) VALUES (?, ?, ?)',
    memory.id, memory.text, Date.now(),
  );
}

export async function deleteMemory(id: string) {
  const db = await database();
  await db.runAsync('DELETE FROM memories WHERE id = ?', id);
}

export async function clearMemories() {
  const db = await database();
  await db.runAsync('DELETE FROM memories');
}
