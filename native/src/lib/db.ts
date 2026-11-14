// The app's database: chats, their messages, and memories, in SQLite.
//
// Settings and other small preferences stay in key-value storage (see
// storage.ts); everything that grows or is searched lives here.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import type { Chat, ChatMeta, Memory, Message } from './storage';

type Db = SQLite.SQLiteDatabase;

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    titled INTEGER NOT NULL DEFAULT 0,
    pinned INTEGER NOT NULL DEFAULT 0,
    summary TEXT NOT NULL DEFAULT '',
    cut INTEGER NOT NULL DEFAULT 0,
    ctx TEXT,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    reasoning TEXT,
    thought INTEGER,
    speed REAL,
    stopped TEXT,
    PRIMARY KEY (chat_id, position)
  );
  CREATE INDEX IF NOT EXISTS chats_by_time ON chats(updated_at DESC);
`;

let opening: Promise<Db> | null = null;

function database(): Promise<Db> {
  opening ??= (async () => {
    const db = await SQLite.openDatabaseAsync('pocket.db');
    await db.execAsync(SCHEMA);
    await importOlderData(db);
    return db;
  })();
  return opening;
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Writes happen one at a time, so two saves can never open a transaction inside each other. */
let writes: Promise<unknown> = Promise.resolve();
function inTurn<T>(job: () => Promise<T>): Promise<T> {
  const next = writes.then(job, job);
  writes = next.catch(() => {});
  return next;
}

async function writeChat(db: Db, chat: Chat) {
  await db.runAsync(
    `INSERT INTO chats (id, title, titled, pinned, summary, cut, ctx, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, titled = excluded.titled, pinned = excluded.pinned,
       summary = excluded.summary, cut = excluded.cut, ctx = excluded.ctx, updated_at = excluded.updated_at`,
    chat.id, chat.title, chat.titled ? 1 : 0, chat.pinned ? 1 : 0, chat.summary, chat.cut,
    chat.ctx ? JSON.stringify(chat.ctx) : null, chat.updatedAt,
  );
  await db.runAsync('DELETE FROM messages WHERE chat_id = ?', chat.id);
  for (let i = 0; i < chat.messages.length; i++) {
    const m = chat.messages[i];
    await db.runAsync(
      `INSERT INTO messages (chat_id, position, id, role, content, reasoning, thought, speed, stopped)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      chat.id, i, m.id ?? newId(), m.role, m.content, m.reasoning ?? null, m.thought ?? null,
      m.speed ?? null, m.stopped ?? null,
    );
  }
}

/**
 * Earlier versions kept chats and memories as JSON in key-value storage.
 * Move them into the database once, then remove the old copies.
 */
async function importOlderData(db: Db) {
  const [oldMemories, oldList] = await Promise.all([
    AsyncStorage.getItem('memories').catch(() => null),
    AsyncStorage.getItem('chats').catch(() => null),
  ]);

  if (oldMemories) {
    try {
      const memories = JSON.parse(oldMemories) as Memory[];
      const now = Date.now();
      for (let i = 0; i < memories.length; i++) {
        await db.runAsync(
          'INSERT OR IGNORE INTO memories (id, text, created_at) VALUES (?, ?, ?)',
          memories[i].id, memories[i].text, now + i,
        );
      }
    } catch {
      // Unreadable old data is left out rather than blocking the app.
    }
    await AsyncStorage.removeItem('memories').catch(() => {});
  }

  if (oldList) {
    let list: ChatMeta[] = [];
    try {
      list = JSON.parse(oldList) as ChatMeta[];
    } catch {
      // Nothing usable to import.
    }
    for (const meta of list) {
      const key = `chat:${meta.id}`;
      try {
        const raw = await AsyncStorage.getItem(key);
        if (raw) {
          const chat = JSON.parse(raw) as Chat;
          await db.withTransactionAsync(() => writeChat(db, { ...chat, pinned: chat.pinned ?? meta.pinned }));
        }
        await AsyncStorage.removeItem(key);
      } catch {
        // Skip a chat that cannot be read; the rest still come across.
      }
    }
    await AsyncStorage.removeItem('chats').catch(() => {});
  }
}

// ---------- memories ----------

export const memoryStore = {
  async all(): Promise<Memory[]> {
    try {
      const db = await database();
      return await db.getAllAsync<Memory>('SELECT id, text FROM memories ORDER BY created_at, rowid');
    } catch {
      return [];
    }
  },
  async add(memory: Memory) {
    const db = await database();
    await db.runAsync(
      'INSERT OR REPLACE INTO memories (id, text, created_at) VALUES (?, ?, ?)',
      memory.id, memory.text, Date.now(),
    );
  },
  async remove(id: string) {
    const db = await database();
    await db.runAsync('DELETE FROM memories WHERE id = ?', id);
  },
};

// ---------- chats ----------

type ChatRow = {
  id: string; title: string; titled: number; pinned: number; summary: string; cut: number;
  ctx: string | null; updated_at: number;
};
type MessageRow = {
  id: string; role: Message['role']; content: string; reasoning: string | null;
  thought: number | null; speed: number | null; stopped: string | null;
};
type MetaRow = Pick<ChatRow, 'id' | 'title' | 'pinned' | 'updated_at'> & { snippet?: string | null };

const toMeta = (row: MetaRow): ChatMeta => ({
  id: row.id, title: row.title, updatedAt: row.updated_at, pinned: !!row.pinned,
});

async function list(db: Db): Promise<ChatMeta[]> {
  const rows = await db.getAllAsync<MetaRow>('SELECT id, title, pinned, updated_at FROM chats ORDER BY updated_at DESC');
  return rows.map(toMeta);
}

export const chatStore = {
  async chatList(): Promise<ChatMeta[]> {
    try {
      return await list(await database());
    } catch {
      return [];
    }
  },

  async chat(id: string): Promise<Chat | null> {
    try {
      const db = await database();
      const row = await db.getFirstAsync<ChatRow>('SELECT * FROM chats WHERE id = ?', id);
      if (!row) return null;
      const messages = await db.getAllAsync<MessageRow>(
        'SELECT id, role, content, reasoning, thought, speed, stopped FROM messages WHERE chat_id = ? ORDER BY position',
        id,
      );
      return {
        id: row.id,
        title: row.title,
        titled: !!row.titled,
        pinned: !!row.pinned,
        summary: row.summary,
        cut: row.cut,
        ctx: row.ctx ? JSON.parse(row.ctx) : null,
        updatedAt: row.updated_at,
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          reasoning: m.reasoning ?? undefined,
          thought: m.thought ?? undefined,
          speed: m.speed ?? undefined,
          stopped: m.stopped ?? undefined,
        })),
      };
    } catch {
      return null;
    }
  },

  saveChat(chat: Chat): Promise<ChatMeta[]> {
    return inTurn(async () => {
      const db = await database();
      await db.withTransactionAsync(() => writeChat(db, chat));
      return list(db);
    });
  },

  /** Changes a chat's title or pin without moving it to the top of the list. */
  updateChat(id: string, patch: Partial<Pick<Chat, 'title' | 'titled' | 'pinned'>>): Promise<ChatMeta[]> {
    return inTurn(async () => {
      const db = await database();
      if (patch.title !== undefined) await db.runAsync('UPDATE chats SET title = ? WHERE id = ?', patch.title, id);
      if (patch.titled !== undefined) await db.runAsync('UPDATE chats SET titled = ? WHERE id = ?', patch.titled ? 1 : 0, id);
      if (patch.pinned !== undefined) await db.runAsync('UPDATE chats SET pinned = ? WHERE id = ?', patch.pinned ? 1 : 0, id);
      return list(db);
    });
  },

  deleteChat(id: string): Promise<ChatMeta[]> {
    return inTurn(async () => {
      const db = await database();
      await db.runAsync('DELETE FROM chats WHERE id = ?', id);
      return list(db);
    });
  },

  deleteAllChats(): Promise<void> {
    return inTurn(async () => {
      const db = await database();
      await db.runAsync('DELETE FROM chats');
    });
  },

  async allChats(): Promise<Chat[]> {
    const metas = await chatStore.chatList();
    const chats = await Promise.all(metas.map((m) => chatStore.chat(m.id)));
    return chats.filter((c): c is Chat => c !== null);
  },

  /** Chats whose title or messages contain the text, newest first, with a few words of context. */
  async searchChats(query: string): Promise<(ChatMeta & { snippet?: string })[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    try {
      const db = await database();
      const rows = await db.getAllAsync<MetaRow>(
        `SELECT c.id, c.title, c.pinned, c.updated_at,
           (SELECT substr(m.content, max(1, instr(lower(m.content), ?) - 30), 100)
              FROM messages m
             WHERE m.chat_id = c.id AND instr(lower(m.content), ?) > 0
             ORDER BY m.position LIMIT 1) AS snippet
           FROM chats c
          WHERE instr(lower(c.title), ?) > 0
             OR EXISTS (SELECT 1 FROM messages m WHERE m.chat_id = c.id AND instr(lower(m.content), ?) > 0)
          ORDER BY c.updated_at DESC
          LIMIT 60`,
        q, q, q, q,
      );
      return rows.map((row) => ({
        ...toMeta(row),
        snippet: row.snippet ? row.snippet.replace(/\s+/g, ' ').trim() : undefined,
      }));
    } catch {
      return [];
    }
  },
};
