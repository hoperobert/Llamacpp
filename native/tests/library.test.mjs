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
assert.equal((await ask('what does treat a burn mean', { entriesOnly: true })).length, 1);
assert.deepEqual(await ask('how hot should water be to treat a burn', { entriesOnly: true }), [], 'not asked what a word means');
// A passage that holds every word of a question is found. One that holds only some is not.
assert.ok((await ask('should I use ice on a burn?')).length > 0);
assert.deepEqual(await ask('is ice good for a burn'), []);
// Something that is not a question is only matched against titles.
assert.deepEqual(await ask('use ice on that burn', { asking: false }), []);
assert.equal((await ask('write a note on how to treat a burn', { asking: false }))[0].title, 'Treat a Burn');
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
const references = referenceText(passages, 600, () => 'Wikipedia');
// Headed by source and title in words, never by a number the model would then cite.
assert.ok(references.startsWith('Wikipedia: Australia\n'));
assert.ok(!/\[\d\]/.test(references));
assert.ok(referenceText(passages, 600).startsWith('Library: Australia\n'));

// What is worth handing over: an article the message names always, a passage that
// only shares its words for a question, and scraps never.
const { worthUsing } = await import('../src/lib/retrieval.ts');
const article = { title: 'Vaccine', body: 'x', source: 's', pos: 0, score: 1021, words: 1 };
const deeper = { title: 'Roman Empire', body: 'y', source: 's', pos: 4, score: 900 };
const phrase = { title: 'Roman Empire', body: 'x', source: 's', pos: 0, score: 1022, words: 2 };
const maybe = { title: 'Drain', body: 'x', source: 's', pos: 0, score: 711, words: 1 };
const mention = { title: 'Jane Austen', body: 'x', source: 's', pos: 3, score: 499 };
const scrap = { title: 'Shorter', body: 'x', source: 's', pos: 2, score: 98 };
const kept = (found, message) => worthUsing(found, message).map((p) => `${p.title}#${p.pos}`);
assert.deepEqual(kept([article, maybe, mention, scrap], 'How do vaccines work?'), ['Vaccine#0', 'Drain#0', 'Jane Austen#3']);
assert.deepEqual(kept([article, mention, scrap], 'tell me about vaccines'), ['Vaccine#0', 'Jane Austen#3']);
assert.deepEqual(kept([mention, scrap], 'make that a bit shorter please'), [], 'a remark is not looked up');
assert.deepEqual(kept([article, maybe, mention], 'lol vaccines'), [], 'nor is one word in passing');
assert.deepEqual(kept([phrase, deeper, article, mention], 'write an essay on the Roman Empire'), ['Roman Empire#0', 'Roman Empire#4'], 'but something named in full is');
assert.deepEqual(kept([scrap], 'what should I do next?'), []);

// A polite request is still a request, and a polite question still a question.
const { asks } = await import('../src/lib/retrieval.ts');
assert.equal(asks('can you rewrite that more formally?'), false);
assert.equal(asks('could you make it shorter'), false);
assert.equal(asks('can you tell me who wrote Pride and Prejudice?'), true);
assert.equal(asks('please explain how vaccines work'), true);
assert.equal(asks('is it safe?'), true);
assert.equal(asks('thanks'), false);

// Pages that are only lists of links are passed over.
await library.addText('Index of biology articles', 'Photosynthesis. Vaccine. Cell. Enzyme. Panda. Bamboo.');
assert.ok(!(await top('What do pandas eat?')).includes('Index of biology articles'));
await library.removeText('Index of biology articles');
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
