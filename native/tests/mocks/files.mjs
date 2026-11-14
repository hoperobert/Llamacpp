// A pretend disk: file name -> size in bytes.
export const disk = new Map();
export const Paths = { document: 'doc', availableDiskSpace: 50e9 };
export class File {
  constructor(_dir, name) { this.name = name; this.uri = `file:///doc/${name}`; }
  get exists() { return disk.has(this.name); }
  get size() { return disk.get(this.name) ?? null; }
  delete() { disk.delete(this.name); }
}
export class Directory { constructor() {} create() {} get exists() { return false; } delete() {} }
