// Drives the app's real download code through the situation in the screenshot:
// downloads left over from an older build, resumed with a link the server now refuses.
import assert from 'node:assert/strict';
import { created, makeTask, setExisting } from './mocks/downloader.mjs';
import { disk } from './mocks/files.mjs';
import { data } from './mocks/storage.mjs';

const model = { id: 'qwen35-4b', name: 'Qwen3.5 4B', note: '', sizeMB: 3032, file: 'Qwen3.5-4B-Q4_K_M.gguf', url: 'https://example/q.gguf', group: 'smart' };
const paused = { id: 'lfm3-1.7b', name: 'LFM3 1.7B', note: '', sizeMB: 1100, file: 'LFM3.gguf', url: 'https://example/l.gguf', group: 'fast' };
const tick = () => new Promise((r) => setTimeout(r, 5));

// At launch the library reports both as paused. The user had paused only LFM3 on purpose.
data.set('pausedDownloads', JSON.stringify(['lfm3-1.7b']));
const old = makeTask({ id: model.id, state: 'PAUSED', bytesDownloaded: 76e6, bytesTotal: 3032e6, file: model.file });
const oldPaused = makeTask({ id: paused.id, state: 'PAUSED', bytesDownloaded: 10e6, bytesTotal: 1100e6, file: paused.file });
setExisting([old, oldPaused]);

const d = await import('../src/lib/downloads.ts');
const events = [];
await d.restoreDownloads([model, paused], (id, state, done) => events.push({ id, status: state?.status ?? null, error: state?.error, done }));

assert.deepEqual(old.log, ['resume'], 'an interrupted download is resumed by itself');
assert.deepEqual(oldPaused.log, [], 'a download the user paused is left alone');
assert.equal(events.find((e) => e.id === paused.id).status, 'paused');
assert.equal(events.find((e) => e.id === model.id).status, 'downloading');

// The server refuses the old signed link.
events.length = 0;
old.failWith('forbidden');
await tick();
assert.ok(old.log.includes('stop'), 'the stale task is stopped, which clears its saved link');
assert.equal(created.length, 1, 'a fresh download is started from the real address');
assert.deepEqual(created[0].log, ['start']);
assert.ok(!events.some((e) => e.status === 'failed'), 'no failure is shown to the user');
assert.equal(events.at(-1).status, 'downloading');

// The fresh download completes with the full file.
events.length = 0;
created[0].finishWith(3032091584);
await tick();
assert.deepEqual(events.at(-1), { id: model.id, status: null, error: undefined, done: true });
assert.equal(await d.isDownloaded(model), true);

// A second refusal in a row is not retried forever: it is shown, with a clear message.
const again = { ...model, id: 'again', file: 'again.gguf' };
d.startDownload(again);
const first = created.at(-1);
first.failWith('forbidden'); await tick();
const second = created.at(-1);
assert.notEqual(first, second, 'restarted once');
events.length = 0;
second.failWith('forbidden'); await tick();
assert.equal(events.at(-1).status, 'failed');
assert.equal(events.at(-1).error, 'The download link expired. Tap Retry.');

// A file that arrives far too small is rejected, not marked as ready.
const short = { ...model, id: 'short', file: 'short.gguf' };
d.startDownload(short);
events.length = 0;
created.at(-1).finishWith(2e6);
await tick();
assert.equal(events.at(-1).status, 'failed');
assert.equal(disk.has('short.gguf'), false, 'the bad file is removed');
assert.equal(await d.isDownloaded(short), false);
console.log('ALL DOWNLOAD CHECKS PASSED');
