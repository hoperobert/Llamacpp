// Stand-in for the browser preview, where SQLite is not set up. The real
// store is in memories.ts.

import type { Memory } from './storage';

let rows: Memory[] = [];

export const loadMemories = async (): Promise<Memory[]> => rows;
export async function insertMemory(memory: Memory) { rows = [...rows.filter((m) => m.id !== memory.id), memory]; }
export async function deleteMemory(id: string) { rows = rows.filter((m) => m.id !== id); }
export async function clearMemories() { rows = []; }
