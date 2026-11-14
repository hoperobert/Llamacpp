// A pretend disk. A file is a size plus a record of what was written where,
// so a test can check that pieces were joined in the right order without
// holding gigabytes in memory. `fill` is the byte value a region holds.
export const disk = new Map(); // name -> { size, runs: [{ offset, length, fill }] }

export const Paths = { document: 'doc', availableDiskSpace: 50e9 };
export const FileMode = { ReadWrite: 'rw', ReadOnly: 'r' };

/** Puts a file on the disk as if a download had written it. */
export function writeWhole(name, size, fill) {
  disk.set(name, { size, runs: [{ offset: 0, length: size, fill }] });
}

/** The fill values of a file from start to end, with the length of each stretch. */
export function layout(name) {
  const file = disk.get(name);
  const runs = [...file.runs].sort((a, b) => a.offset - b.offset);
  const merged = [];
  for (const run of runs) {
    const last = merged.at(-1);
    if (last && last.fill === run.fill && last.offset + last.length === run.offset) last.length += run.length;
    else merged.push({ ...run });
  }
  return merged;
}

export class File {
  constructor(_directory, name) {
    this.name = name;
    this.uri = `file:///doc/${name}`;
  }
  get exists() { return disk.has(this.name); }
  get size() { return disk.get(this.name)?.size ?? null; }
  create() { disk.set(this.name, { size: 0, runs: [] }); }
  delete() { disk.delete(this.name); }
  // Asynchronous, as on a phone: the file is not in its new place until this resolves.
  async move(destination) {
    await new Promise((resolve) => setImmediate(resolve));
    disk.set(destination.name, disk.get(this.name));
    disk.delete(this.name);
  }
  open() {
    const file = disk.get(this.name);
    if (!file) throw new Error(`No such file: ${this.name}`);
    return {
      offset: 0,
      async readBytes(length) {
        const count = Math.max(0, Math.min(length, file.size - this.offset));
        const fill = file.runs.find((r) => this.offset >= r.offset && this.offset < r.offset + r.length)?.fill ?? 0;
        this.offset += count;
        return new Uint8Array(count).fill(fill);
      },
      async writeBytes(bytes) {
        // Writing over a region replaces what was there.
        file.runs = file.runs.filter((r) => r.offset + r.length <= this.offset || r.offset >= this.offset + bytes.length);
        file.runs.push({ offset: this.offset, length: bytes.length, fill: bytes[0] });
        this.offset += bytes.length;
        file.size = Math.max(file.size, this.offset);
      },
      close() {},
    };
  }
}

export class Directory {
  create() {}
  get exists() { return false; }
  delete() {}
}
