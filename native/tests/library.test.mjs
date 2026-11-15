// The offline library: cutting text into passages, finding the right ones for
// a question, and building the index from a downloaded file, including when
// the app is closed part-way.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { disk, faults, writeBytes } from './mocks/files.mjs';
import { data } from './mocks/storage.mjs';

const { chunk, referenceText, terms, withReferences, worthLookingUp } = await import('../src/lib/retrieval.ts');
const library = await import('../src/lib/library.ts');

// ---------- passages ----------
const long = Array.from({ length: 60 }, (_, i) => `Sentence ${i} says something plain.`).join(' ');
const pieces = chunk(`Short opening.\n\n${long}\n\nA closing line.`);
assert.ok(pieces.length > 2, 'a long text is cut up');
assert.ok(pieces.every((p) => p.length <= 900), 'no passage is over the limit');
assert.ok(pieces[0].startsWith('Short opening.'));
assert.equal(pieces.join(' ').replace(/\s+/g, ' '), `Short opening. ${long} A closing line.`, 'nothing is lost');
assert.equal(chunk('x'.repeat(2000)).length, 3, 'a run with no breaks is cut by length');
assert.deepEqual(chunk('  \n\n '), []);

// ---------- questions ----------
assert.deepEqual(terms('What is the capital of Australia?'), ['capital', 'australia']);
assert.equal(worthLookingUp('Hi'), false);
assert.equal(worthLookingUp('what is 2+2'), false);
assert.equal(worthLookingUp('How do vaccines work?'), true);

// ---------- building the index from a download ----------
const source = library.SOURCES[0];
const fixture = fs.readFileSync(new URL('./fixtures/library.parquet', import.meta.url));
const states = [];
await library.restoreLibrary((id, state) => states.push({ id, ...state }), () => false);
assert.equal(library.libraryReady(), false);
assert.deepEqual(await library.lookup('capital of Australia'), [], 'nothing to search yet');

// The app is closed while the second group of articles is being read.
writeBytes(source.file, fixture);
faults.readsLeft = 2;
await library.prepare(source);
assert.equal(states.at(-1).status, 'failed');
const part = JSON.parse(data.get(`library:${source.id}`));
assert.equal(part.groups, 1, 'the first group was kept');
assert.equal(part.ready, false);
assert.ok(disk.has(source.file), 'the download is kept until the index is whole');

// Opening the app again carries on rather than starting over.
faults.readsLeft = Infinity;
states.length = 0;
await library.restoreLibrary((id, state) => states.push({ id, ...state }), () => true);
await new Promise((resolve) => setTimeout(resolve, 200));
assert.equal(states.at(-1).status, 'ready');
assert.ok(states.some((s) => s.status === 'preparing' && s.progress > 0 && s.progress < 1), 'progress is reported');
assert.equal(disk.has(source.file), false, 'the download is deleted once indexed');
assert.equal(library.libraryReady(), true);

const { files } = await import('./mocks/sqlite.mjs');
const count = (name) => files.get(name).prepare('SELECT count(*) AS n FROM passages').get().n;
const titles = files.get(`library-${source.id}.db`).prepare('SELECT DISTINCT title FROM passages').all().map((r) => r.title);
assert.equal(titles.length, 7, 'every article is in, once');
assert.equal(count(`library-${source.id}.db`), states.at(-1).passages, 'no passage was indexed twice');

// ---------- looking things up ----------
const top = async (question) => (await library.lookup(question)).map((p) => p.title);
assert.equal((await top('What is the capital of Australia?'))[0], 'Australia');
assert.ok((await top('What is the capital of Australia?')).includes('Canberra'));
assert.equal((await top('How do vaccines work?'))[0], 'Vaccine', 'word endings are matched');
assert.equal((await top('how tall is mount everest'))[0], 'Mount Everest');
assert.equal((await top('tell me about mercury'))[0], 'Mercury (planet)', 'a page that only lists meanings is passed over');
assert.equal((await top('What do pandas eat?'))[0], 'Panda');
assert.deepEqual(await top('zxqv'), []);
const canberra = await library.lookup('Walter Burley Griffin Canberra', 5);
assert.ok(canberra.filter((p) => p.title === 'Canberra').length <= 2, 'one article does not crowd out the rest');

// ---------- your own files ----------
let mine = await library.addText('boiler.txt', 'The boiler pressure should be between 1 and 1.5 bar. Top it up with the silver tap.');
assert.deepEqual(mine, [{ name: 'boiler.txt', passages: 1 }]);
const boiler = await library.lookup('what should the boiler pressure be');
assert.equal(boiler[0].title, 'boiler.txt', 'your own files come first');
mine = await library.addText('boiler.txt', 'The boiler pressure should be 2 bar.');
assert.equal(count('library-files.db'), 1, 'adding a file again replaces it');
mine = await library.removeText('boiler.txt');
assert.deepEqual(mine, []);
assert.ok(!(await top('boiler pressure')).includes('boiler.txt'));

// ---------- what the model is given ----------
const passages = await library.lookup('What is the capital of Australia?');
const references = referenceText(passages, 600);
assert.ok(references.startsWith('[1] Australia\n'));
assert.ok(references.length < 700, 'kept within the room allowed');
const asked = withReferences('What is the capital of Australia?', references);
assert.ok(asked.includes(references));
assert.ok(asked.endsWith('Question: What is the capital of Australia?'), 'the question comes last');

// ---------- removing a source ----------
await library.removeSource(source);
assert.equal(library.libraryReady(), false);
assert.equal(data.has(`library:${source.id}`), false);
assert.deepEqual(await top('capital of Australia'), []);

console.log('library: all checks passed');
