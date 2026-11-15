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

// ---------- several sources ----------
const { best, STRONG, WEAK, EVERY_WORD, SOME_WORDS } = await import('../src/lib/retrieval.ts');
const find = (source, title, score, pos = 0, body = `${title} ${source} ${pos}`) => ({ source, title, score, pos, body });
assert.deepEqual(
  best([find('a', 'Mount Everest', STRONG + 32), find('b', 'Mount Everest', STRONG + 32), find('b', 'Oceanic zone', EVERY_WORD)]).map((p) => `${p.source}/${p.title}`),
  ['a/Mount Everest', 'b/Oceanic zone'], 'the same article from two sources is given once',
);
assert.deepEqual(
  best([find('a', 'Ada Lovelace', STRONG + 22), find('b', 'Consciousness', EVERY_WORD, 33), find('a', 'Lovelace', EVERY_WORD - 1)]).map((p) => p.title),
  ['Ada Lovelace', 'Lovelace'], 'a passing mention in another source is left out when the subject was found',
);
assert.deepEqual(
  best([find('a', 'Bowline knot', STRONG + 31), find('b', 'Knot', WEAK + 11), find('b', 'Rope', WEAK + 11)]).map((p) => p.title),
  ['Bowline knot'], 'a looser match adds nothing beside the subject',
);
assert.deepEqual(
  best([find('a', 'Drain', WEAK + 11), find('b', 'Sodium hydroxide', EVERY_WORD), find('c', 'Rain', SOME_WORDS)]).map((p) => p.title),
  ['Drain', 'Sodium hydroxide', 'Rain'], 'with no sure subject the best of everything is kept',
);

// A guide is found without the "How to" every title starts with, and its parts are joined under one title.
const howto = library.SOURCES.find((s) => s.id === 'howto');
writeBytes(howto.file, fs.readFileSync(new URL('./fixtures/howto.parquet', import.meta.url)));
await library.prepare(howto);
assert.equal(states.at(-1).status, 'ready');
const guides = files.get('library-howto.db').prepare('SELECT DISTINCT title FROM passages ORDER BY title').all().map((r) => r.title);
assert.deepEqual(guides, ['Tie a Tie', 'Treat a Burn']);
assert.equal((await top('how do i tie a tie'))[0], 'Tie a Tie');
assert.equal((await top('how to treat a burn'))[0], 'Treat a Burn');
assert.equal((await top('What is the capital of Australia?'))[0], 'Australia', 'the other source still answers its own');

// A dictionary has an entry for every word, so it only answers when asked about one.
const { retrieve } = await import('../src/lib/retrieval.ts');
const words = files.get('library-howto.db');
const ask = (question, options) => retrieve(async (sql, params) => words.prepare(sql).all(...params), question, 3, options);
assert.equal((await ask('how hot should water be to treat a burn', { entriesOnly: true })).length, 1);
assert.deepEqual(await ask('is ice good for a burn', { entriesOnly: true }), []);
assert.ok((await ask('is ice good for a burn')).length > 0);
await library.removeSource(howto);

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
