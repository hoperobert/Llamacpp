// Drives the app's real download code through the ways a download gets
// interrupted, and checks that what has arrived is never thrown away.
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { created, setExisting } from './mocks/downloader.mjs';
import { disk, layout, writeWhole } from './mocks/files.mjs';
import { data } from './mocks/storage.mjs';

mock.timers.enable({ apis: ['setTimeout'] });
// Lets everything that is waiting on a promise run, however many steps it takes.
const settle = async () => { for (let i = 0; i < 200; i++) await new Promise((resolve) => setImmediate(resolve)); };
const after = async (ms) => { mock.timers.tick(ms); await settle(); };

const MB = 1024 * 1024;
const PIECE = 64 * MB;
const TOTAL = 3 * PIECE + 5 * MB;          // four pieces, the last one short

// The server says how big the file is, and that it can send ranges.
let serverAnswer = () => ({ ok: true, status: 206, headers: { get: () => `bytes 0-0/${TOTAL}` } });
globalThis.fetch = async () => serverAnswer();

const model = (id) => ({ id, name: id, note: '', sizeMB: Math.round(TOTAL / 1e6), file: `${id}.gguf`, url: `https://example/${id}.gguf`, group: 'smart' });
const events = [];
const listen = (id, state, done) => events.push({ id, done, ...(state ?? { status: null }) });
const last = (id) => events.filter((e) => e.id === id).at(-1);
const liveFor = (id) => created.filter((t) => t.id.startsWith(`${id}#`) && t.state === 'DOWNLOADING');

/** Loads the download code afresh, as happens when the app is opened again. */
let opens = 0;
const openApp = async (models) => {
  const code = await import(`../src/lib/downloads.ts?open=${++opens}`);
  await code.restoreDownloads(models, listen);
  await settle();
  return code;
};

// ---------- a download that loses its connection, then the app is closed ----------
{
  const a = model('a');
  let app = await openApp([a]);
  await app.startDownload(a);
  await settle();

  const tasks = liveFor('a');
  assert.deepEqual(tasks.map((t) => t.headers.Range), [
    `bytes=0-${PIECE - 1}`, `bytes=${PIECE}-${2 * PIECE - 1}`, `bytes=${2 * PIECE}-${3 * PIECE - 1}`, `bytes=${3 * PIECE}-${TOTAL - 1}`,
  ], 'the file is asked for in four pieces');

  tasks[0].finish();
  tasks[1].finish();
  tasks[2].arrive(30 * MB);
  await settle();
  assert.equal(last('a').loaded, 2 * PIECE + 30 * MB);

  // The connection drops mid-piece.
  const before = created.length;
  events.length = 0;
  tasks[2].fail('The network connection was lost.');
  await after(2000);
  assert.equal(created.length, before + 1, 'only the piece that was cut off is fetched again');
  assert.equal(created.at(-1).id, 'a#2');
  assert.ok(events.every((e) => e.loaded >= 2 * PIECE), 'the two finished pieces are never lost');
  assert.ok(events.every((e) => e.status !== 'failed'), 'no failure is shown for a single dropped piece');

  // The app is closed and opened again. iOS kept the two remaining pieces going.
  setExisting(liveFor('a'));
  const count = created.length;
  events.length = 0;
  app = await openApp([a]);
  assert.equal(created.length, count, 'reopening the app starts nothing new');
  assert.equal(last('a').status, 'downloading');
  assert.ok(last('a').loaded >= 2 * PIECE);

  // The app is updated. iOS stops every download in progress.
  for (const t of liveFor('a')) { t.state = 'STOPPED'; disk.delete(t.file); }
  setExisting([]);
  events.length = 0;
  app = await openApp([a]);
  const restarted = liveFor('a');
  assert.deepEqual(restarted.map((t) => t.id), ['a#2', 'a#3'], 'after an update only the missing pieces are fetched');
  assert.equal(last('a').loaded, 2 * PIECE, 'progress after an update is what was already saved');

  // The rest arrives and the pieces are joined.
  restarted[0].finish();
  restarted[1].finish();
  await settle();
  assert.equal(last('a').done, true);
  assert.equal(disk.get('a.gguf').size, TOTAL);
  assert.deepEqual(layout('a.gguf'), [
    { offset: 0, length: PIECE, fill: 0 }, { offset: PIECE, length: PIECE, fill: 1 },
    { offset: 2 * PIECE, length: PIECE, fill: 2 }, { offset: 3 * PIECE, length: 5 * MB, fill: 3 },
  ], 'the pieces are joined in order');
  assert.deepEqual([...disk.keys()].filter((k) => k.startsWith('a.')), ['a.gguf'], 'the pieces are cleaned up');
  assert.equal(data.has('plan:a'), false);
  assert.equal(await app.isDownloaded(a), true);
}

// ---------- pausing, closing the app, and carrying on ----------
{
  const b = model('b');
  let app = await openApp([b]);
  await app.startDownload(b);
  await settle();
  liveFor('b')[0].finish();
  liveFor('b')[0].arrive(10 * MB);
  await app.pauseDownload(b);
  assert.equal(last('b').status, 'paused');
  assert.equal(last('b').loaded, PIECE, 'a paused download keeps its finished piece');
  assert.equal(liveFor('b').length, 0);

  setExisting([]);
  const count = created.length;
  app = await openApp([b]);
  assert.equal(created.length, count, 'a paused download stays paused when the app is reopened');
  assert.equal(last('b').status, 'paused');
  assert.equal(last('b').loaded, PIECE);

  await app.startDownload(b);
  await settle();
  assert.deepEqual(liveFor('b').map((t) => t.id), ['b#1', 'b#2', 'b#3'], 'resuming fetches only what is missing');
  for (const t of liveFor('b')) t.finish();
  await settle();
  assert.equal(last('b').done, true);
  assert.equal(disk.get('b.gguf').size, TOTAL);
}

// ---------- the app is closed halfway through joining ----------
{
  const c = model('c');
  // Piece 0 was joined and removed; the join file may hold part of piece 1 as well.
  disk.set('c.gguf.joining', { size: PIECE + 3 * MB, runs: [{ offset: 0, length: PIECE, fill: 0 }, { offset: PIECE, length: 3 * MB, fill: 1 }] });
  writeWhole('c.gguf.part1', PIECE, 1);
  writeWhole('c.gguf.part2', PIECE, 2);
  writeWhole('c.gguf.part3', 5 * MB, 3);
  data.set('plan:c', JSON.stringify({ total: TOTAL, piece: PIECE, count: 4, ranged: true, joined: 1 }));
  setExisting([]);
  const count = created.length;
  const app = await openApp([c]);
  assert.equal(created.length, count, 'nothing is downloaded again');
  assert.equal(last('c').done, true);
  assert.deepEqual(layout('c.gguf').map((r) => [r.offset, r.length, r.fill]), [
    [0, PIECE, 0], [PIECE, PIECE, 1], [2 * PIECE, PIECE, 2], [3 * PIECE, 5 * MB, 3],
  ], 'an interrupted join is completed correctly');
  assert.equal(await app.isDownloaded(c), true);
}

// ---------- a piece that keeps failing, and the connection coming back ----------
{
  const d = model('d');
  const app = await openApp([d]);
  await app.startDownload(d);
  await settle();
  const [first, ...rest] = liveFor('d');
  for (const t of rest) t.finish();
  first.fail('The Internet connection appears to be offline.');
  for (let i = 0; i < 6; i++) {
    await after(31000);
    liveFor('d')[0]?.fail('The Internet connection appears to be offline.');
    await settle();
  }
  assert.equal(last('d').status, 'failed');
  assert.match(last('d').error, /connection dropped/);
  assert.equal(last('d').loaded, 2 * PIECE + 5 * MB, 'what arrived is still there after it gives up');

  app.resumeFailedDownloads();
  await settle();
  assert.deepEqual(liveFor('d').map((t) => t.id), ['d#0'], 'when the connection returns only the missing piece is fetched');
  liveFor('d')[0].finish();
  await settle();
  assert.equal(last('d').done, true);
}

// ---------- a server that cannot send ranges ----------
{
  serverAnswer = () => ({ ok: true, status: 200, headers: { get: () => null } });
  const e = model('e');
  const app = await openApp([e]);
  await app.startDownload(e);
  await settle();
  const [only] = liveFor('e');
  assert.equal(liveFor('e').length, 1);
  assert.equal(only.headers, undefined, 'the whole file is fetched in one go');
  only.finish(TOTAL);
  await settle();
  assert.equal(last('e').done, true);
  assert.equal(disk.get('e.gguf').size, TOTAL);
}

// ---------- a piece that arrives the wrong size ----------
{
  serverAnswer = () => ({ ok: true, status: 206, headers: { get: () => `bytes 0-0/${TOTAL}` } });
  const f = model('f');
  const app = await openApp([f]);
  await app.startDownload(f);
  await settle();
  const before = created.length;
  liveFor('f')[0].finish(2000);          // an error page instead of 64 MB
  await after(2000);
  assert.equal(created.length, before + 1, 'a piece of the wrong size is fetched again');
  assert.equal(created.at(-1).id, 'f#0');
  await app.deleteModel(f);
  assert.deepEqual([...disk.keys()].filter((k) => k.startsWith('f.')), [], 'deleting removes every piece');
}

console.log('ALL DOWNLOAD CHECKS PASSED');
