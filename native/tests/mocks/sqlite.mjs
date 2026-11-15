// expo-sqlite's interface, backed by a real SQLite engine.
import { DatabaseSync } from 'node:sqlite';
export const files = new Map();
export async function openDatabaseAsync(name) {
  if (!files.has(name)) files.set(name, new DatabaseSync(':memory:'));
  const db = files.get(name);
  const flat = (params) => (params.length === 1 && Array.isArray(params[0]) ? params[0] : params);
  return {
    async execAsync(sql) { db.exec(sql); },
    async runAsync(sql, ...params) { return db.prepare(sql).run(...flat(params)); },
    async getAllAsync(sql, ...params) { return db.prepare(sql).all(...flat(params)); },
    async getFirstAsync(sql, ...params) { return db.prepare(sql).get(...flat(params)) ?? null; },
    async closeAsync() {},
    async withTransactionAsync(task) {
      db.exec('BEGIN');
      try { await task(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}
export async function deleteDatabaseAsync(name) { files.delete(name); }
