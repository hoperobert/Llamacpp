// Looking things up in the offline library: cutting articles into passages,
// turning a question into a search, and choosing what to hand to the model.
//
// Nothing here touches the phone. It is given a way to run a query, so the
// same code is used by the app and by the tests.

export type Passage = {
  title: string;
  body: string;
  /** Which library source this came from. */
  source: string;
  /** Position of the passage in its article. 0 is the opening. */
  pos: number;
  /** How good a find it is, so finds from several sources can be put in order. */
  score?: number;
  /** For an article the message names: how many words of the message its title is. */
  words?: number;
};

export type Query = <T>(sql: string, params: (string | number)[]) => Promise<T[]>;

export const LIBRARY_SCHEMA = `
  CREATE VIRTUAL TABLE IF NOT EXISTS passages USING fts5(
    title, body, source UNINDEXED, pos UNINDEXED,
    tokenize = 'porter unicode61 remove_diacritics 2'
  );
`;

const PASSAGE_CHARS = 900;

/** Cuts a text into passages of a few sentences, breaking at paragraph ends where it can. */
export function chunk(text: string): string[] {
  const out: string[] = [];
  let current = '';
  const flush = () => {
    if (current.trim()) out.push(current.trim());
    current = '';
  };
  for (const raw of text.split(/\n+/)) {
    const paragraph = raw.trim();
    if (!paragraph) continue;
    if (current && current.length + paragraph.length + 1 > PASSAGE_CHARS) flush();
    if (paragraph.length <= PASSAGE_CHARS) {
      current += (current ? '\n' : '') + paragraph;
      continue;
    }
    // A long paragraph is cut between sentences.
    for (const sentence of paragraph.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [paragraph]) {
      if (current && current.length + sentence.length > PASSAGE_CHARS) flush();
      // A single run with no sentence breaks is cut by length as a last resort.
      for (let i = 0; i < sentence.length; i += PASSAGE_CHARS) {
        if (current && current.length + Math.min(PASSAGE_CHARS, sentence.length - i) > PASSAGE_CHARS) flush();
        current += sentence.slice(i, i + PASSAGE_CHARS);
      }
    }
  }
  flush();
  return out;
}

const STOP = new Set((
  'a an and are as at be been but by can could did do does for from had has have he her him his how i if in into ' +
  'is it its me my of on or our she should so than that the their them then there these they this to was we were ' +
  'what when where which who whom why will with would you your about tell explain describe give show list please ' +
  'know like just also much many some any most more very between during after before over under again whats ' +
  'define definition meaning mean means word'
).split(' '));

// Accents are dropped, as the index drops them: "Pokémon" is found by "pokemon".
const wordsOf = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

// Plurals only. Matching "tired" to "Tire" or "poisoning" to "Poison" found articles nobody asked about.
const ENDINGS = ['s', 'es'];

/** True when two words are the same give or take an ending: "vaccines" and "vaccine", not "capital" and "capitalism". */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  if (short.endsWith('y') && long === `${short.slice(0, -1)}ies`) return true;
  return long.startsWith(short) && ENDINGS.includes(long.slice(short.length));
}

/** True when a title is the phrase itself, not merely something that contains it. */
function titleIs(title: string, phrase: string[]): boolean {
  const words = wordsOf(title);
  return words.length === phrase.length && words.every((w, i) => sameWord(w, phrase[i]));
}

/** The words of a question worth searching for. */
export function terms(question: string): string[] {
  return [...new Set(wordsOf(question).filter((w) => w.length > 1 && !STOP.has(w)))].slice(0, 12);
}

/** True when a question is worth looking up at all: a greeting or a sum is not. */
export const worthLookingUp = (question: string) => terms(question).some((w) => w.length > 2 && !/^\d+$/.test(w));

const quote = (word: string) => `"${word.replace(/"/g, '')}"`;

/** Runs of up to six words from the question, longest first, that could be the title of an article. */
function titleGuesses(question: string): string[][] {
  const words = wordsOf(question);
  const guesses: string[][] = [];
  for (let length = Math.min(6, words.length); length >= 1; length--) {
    for (let i = 0; i + length <= words.length; i++) {
      const run = words.slice(i, i + length);
      if (STOP.has(run[0]) || STOP.has(run[run.length - 1]) || run[0].length < 2) continue;
      guesses.push(run);
    }
  }
  return guesses.slice(0, 40);
}

/** How many of the question's words a passage mentions. Stems are compared loosely. */
function coverage(passage: Passage, wanted: string[]): number {
  const text = `${passage.title} ${passage.body}`.toLowerCase();
  return wanted.filter((w) => text.includes(w.length > 5 ? w.slice(0, w.length - 2) : w)).length;
}

/** True for a page that only lists other meanings of a word, which is no use as an answer. */
const listsMeanings = (passage: Passage) =>
  passage.pos === 0 && /\b(?:may|can|could)(?: also)? (?:refer to|mean|be:)/i.test(passage.body.slice(0, 160));

// What a find is worth, so that finds from several sources can be put in one order:
// an article that is surely the subject, a passage further into it, an article
// that may be the subject, a passage with every word of the question, and a
// passage with some of them.
export const STRONG = 1000;
export const FURTHER = 900;
export const WEAK = 700;
export const EVERY_WORD = 500;
export const SOME_WORDS = 100;

/**
 * Puts the finds from several sources in one order and keeps the best.
 * It leaves out what would only be noise beside a better find.
 */
export function best(found: Passage[], limit = 3): Passage[] {
  const ordered = [...found].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const sure = ordered.filter((p) => (p.score ?? 0) >= STRONG);
  // Sources that have an article on the subject. With one found, the others have only passing mentions.
  const onSubject = new Set(sure.map((p) => p.source));
  const kept: Passage[] = [];
  for (const passage of ordered) {
    const score = passage.score ?? 0;
    const words = wordsOf(passage.title);
    if (sure.length && score < FURTHER && !onSubject.has(passage.source)) continue;
    // The same article, or the same passage, from two sources is given once.
    if (kept.some((k) => k.pos === passage.pos && wordsOf(k.title).join(' ') === words.join(' '))) continue;
    if (kept.some((k) => k.body.slice(0, 120) === passage.body.slice(0, 120))) continue;
    // "Knot" adds nothing beside "Bowline knot".
    if (score >= WEAK && score < FURTHER && sure.some((k) => {
      const others = wordsOf(k.title);
      return others.length > words.length && words.every((w) => others.some((o) => sameWord(o, w)));
    })) continue;
    kept.push(passage);
    if (kept.length >= limit) break;
  }
  return kept;
}

/** True for a page that is only a list of links to other pages ("Index of biology articles"). */
const onlyLinks = (passage: Passage) => /^(?:index|outline) of\b/i.test(passage.title);

const RANK = `bm25(passages, 8.0, 1.0) * (CASE WHEN pos = 0 THEN 1.5 ELSE 1 END)`;
const COLUMNS = `title, body, source, pos`;

/**
 * Finds the passages most likely to answer a question.
 *
 * First it looks for articles that are about the thing being asked (their
 * title is a phrase from the question), then for passages that mention the
 * question's words, favouring the openings of articles.
 */
export async function retrieve(
  query: Query, question: string, limit = 3,
  options: {
    /** For a dictionary, which has an entry for every word: only answer when asked what a word means. */
    entriesOnly?: boolean;
    /** False for a remark or a request to write something. Then only articles the message names are looked for. */
    asking?: boolean;
  } = {},
): Promise<Passage[]> {
  const { entriesOnly = false, asking = true } = options;
  if (entriesOnly && !aboutAWord(question)) return [];
  const wanted = terms(question);
  if (!wanted.length) return [];
  const chosen: Passage[] = [];
  const perTitle = new Map<string, number>();
  const taken = new Set<string>();
  // Articles about the subject count for most, then passages with every word, then with some.
  const add = (rows: Passage[], worth: number) => {
    for (const [i, found] of rows.entries()) {
      const row = { ...found, score: found.score ?? worth - i };
      const key = `${row.source}/${row.title}#${row.pos}`;
      const count = perTitle.get(row.title) ?? 0;
      if (taken.has(key) || count >= 2 || chosen.length >= limit || listsMeanings(row) || onlyLinks(row)) continue;
      taken.add(key);
      perTitle.set(row.title, count + 1);
      chosen.push(row);
    }
  };

  // 1. Articles named after something in the question.
  const subjects: { passage: Passage; score: number; meaning?: boolean; sure?: boolean }[] = [];
  const covered = new Set<string>();
  for (const guess of titleGuesses(question)) {
    if (guess.every((w) => covered.has(w))) continue;
    const phrase = guess.join(' ');
    const rows = await query<Passage>(
      `SELECT ${COLUMNS} FROM passages WHERE passages MATCH ? AND pos = 0 ORDER BY length(title) LIMIT 4`,
      [`title : ${quote(phrase)}`],
    );
    const hit = rows.find((row) => titleIs(row.title, guess));
    if (!hit) continue;
    if (listsMeanings(hit)) {
      // The word has several meanings, each with its own article, which the page lists:
      // "Mercury (planet)". The ones that speak to the rest of the question go first.
      const names = [...hit.body.matchAll(/^([^\n(]+ \([^)\n]+\))/gm)]
        .map((m) => m[1].trim())
        .filter((name) => wordsOf(name).slice(0, guess.length).join(' ') === phrase)
        .slice(0, 4);
      const meanings: Passage[] = [];
      for (const name of names) {
        const found = await query<Passage>(
          `SELECT ${COLUMNS} FROM passages WHERE passages MATCH ? AND pos = 0 ORDER BY length(title) LIMIT 1`,
          [`title : ${quote(name)}`],
        );
        if (found[0]?.title.toLowerCase() === name.toLowerCase()) meanings.push(found[0]);
      }
      for (const passage of meanings) {
        // "Mercury (planet)" is the one wanted when the question says "planet".
        const named = wanted.filter((w) => !guess.includes(w) && passage.title.toLowerCase().includes(w)).length;
        const speaksTo = coverage(passage, wanted);
        // In a longer question a meaning has to fit the rest of it: "capital of Australia" is not about money.
        if (wanted.length > 1 && !named && speaksTo < 2) continue;
        guess.forEach((w) => covered.add(w));
        subjects.push({ passage: { ...passage, words: guess.length }, score: STRONG + (speaksTo + named * 3) * 10 + guess.length, meaning: true });
      }
      continue;
    }
    // A short everyday word ("end", "work") is only the subject if the article also speaks to the rest of the question.
    const specific = guess.length > 1 || guess[0].length >= 5;
    if (!specific && coverage(hit, wanted) < Math.min(2, wanted.length)) continue;
    guess.forEach((w) => covered.add(w));
    const speaksTo = coverage(hit, wanted);
    // A phrase, or an article that speaks to the whole question, is surely the subject. One word of several may not be.
    const sure = guess.length > 1 || speaksTo >= wanted.length;
    subjects.push({ passage: { ...hit, words: guess.length }, score: (sure ? STRONG : WEAK) + speaksTo * 10 + guess.length, sure });
  }
  // The best subject always counts. A second one has to be a sure one.
  subjects.sort((a, b) => b.score - a.score);
  const picked = subjects.filter((s, i) => (i === 0 && !entriesOnly) || s.meaning || s.sure).slice(0, 2);
  add(picked.map((s) => ({ ...s.passage, score: s.score })), STRONG);
  if (entriesOnly) return chosen;

  // The answer is often further down the subject's article than its opening:
  // the passage of it that says most about the rest of the question.
  const subject = picked[0];
  if (subject && subject.score >= STRONG && chosen.length < limit) {
    const title = wordsOf(subject.passage.title);
    const rest = wanted.filter((w) => !title.some((t) => sameWord(t, w)));
    if (rest.length) {
      const deeper = await query<Passage>(
        `SELECT ${COLUMNS} FROM passages WHERE passages MATCH ? AND pos > 0 ORDER BY bm25(passages, 0.0, 1.0) LIMIT 8`,
        [`(title : ${quote(title.join(' '))}) AND (${rest.map(quote).join(' OR ')})`],
      );
      add(deeper.filter((row) => row.title === subject.passage.title).slice(0, 1), FURTHER);
    }
  }

  // 2. For a question, passages that hold every word of it. Passages that hold
  // only some of the words used to be next; they were rarely about the question,
  // and searching for them was the slow part.
  if (asking && chosen.length < limit && wanted.length > 1) {
    add(await query<Passage>(
      `SELECT ${COLUMNS} FROM passages WHERE passages MATCH ? ORDER BY ${RANK} LIMIT ?`,
      [wanted.map(quote).join(' AND '), limit * 3],
    ), EVERY_WORD);
  }
  return chosen;
}

const ASKING =
  /^(?:who|whom|whose|what|whats|when|where|which|why|how|is|are|was|were|does|do|did|tell me|explain|describe|define)\b/i;

/**
 * True for something asked, as opposed to a remark or a request to write
 * something. "Can you make that shorter?" is a request however it is put, and
 * "could you tell me who wrote it" is a question.
 */
export function asks(text: string): boolean {
  const said = text.trim().replace(/^please[,\s]+/i, '');
  const polite = said.replace(/^(?:can|could|would|will) you (?:please )?/i, '');
  if (polite !== said) return ASKING.test(polite);
  return /\?\s*$/.test(said) || ASKING.test(said);
}

/** True when a message asks what a word means, which is what a dictionary is for. */
export const aboutAWord = (text: string) =>
  /\b(?:define|definition|mean|means|meaning|meant)\b/i.test(text) ||
  (/^what(?:'s|s| is| are)\b/i.test(text.trim()) && terms(text).length === 1);

/**
 * The finds worth giving to the model. Handed over with every message, loosely
 * related passages are noise the model then repeats, so:
 * for a question, an article it names or a passage holding all its words;
 * for anything else, only an article named by two words or more ("the Roman
 * Empire", not "autumn" or "lol"), with what else was found in that article.
 */
export function worthUsing(found: Passage[], message: string): Passage[] {
  if (asks(message)) return found.filter((p) => (p.score ?? 0) > SOME_WORDS);
  const named = found.filter((p) => (p.score ?? 0) >= STRONG && (p.words ?? 0) >= 2);
  const titles = new Set(named.map((p) => p.title));
  return found.filter((p) => named.includes(p) || ((p.score ?? 0) >= FURTHER && (p.score ?? 0) < STRONG && titles.has(p.title)));
}

/**
 * The passages written out for the model, kept within a size it has room for.
 * Each is headed by where it is from, in words the model can repeat: numbering
 * them led it to cite "[1]" or "index 1", which means nothing to the reader.
 */
export function referenceText(
  passages: Passage[], maxChars = 3200, from: (passage: Passage) => string = () => 'Library',
): string {
  const each = Math.floor(maxChars / Math.max(1, passages.length));
  return passages
    .map((p) => `${from(p)}: ${p.title}\n${p.body.length > each ? `${p.body.slice(0, each).trimEnd()}…` : p.body}`)
    .join('\n\n');
}

/** The first line of something read from the phone itself (the calendar, say), not from the library. */
export const FROM_PHONE = 'Read from this iPhone just now, with the user\'s permission.';

/** The first line of first aid steps that are part of the app, given for a question that is plainly about them. */
export const FIRST_AID = 'First aid steps from the app\'s own guide:';

/** The first line of a file the user attached to a message. Its name follows on the same line. */
export const FROM_FILE = 'A file the user attached:';
/** The first line of the text read out of a photo, for a model that cannot look at photos. */
export const FROM_PHOTO = 'Text read from a photo the user sent:';

/** As much of a file as there is room for, headed the way the model is told to expect. */
export function fileText(name: string, text: string, maxChars: number): { context: string; whole: boolean } {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const whole = clean.length <= maxChars;
  const part = whole ? clean : `${clean.slice(0, maxChars)}\n(The file is longer than this. Only its first part is here.)`;
  return { context: `${FROM_FILE} ${name}\n\n${part}`, whole };
}

/** A question with reference material in front of it, as the model is given it. */
export function withReferences(question: string, references: string): string {
  if (references.startsWith(FIRST_AID)) {
    return (
      `${references}\n\nThese steps are correct. Answer with them, in this order, in plain short sentences, fitted to what the ` +
      `user says is happening. Do not add steps of your own or leave out the call for help.\n\nQuestion: ${question}`
    );
  }
  if (references.startsWith(FROM_FILE)) {
    return `${references}\n\nThat is the whole of what the user attached. Work from it.\n\n${question || 'Summarise this file.'}`;
  }
  if (references.startsWith(FROM_PHOTO)) {
    return `${references}\n\nThe user cannot show you the photo itself, only this text from it.\n\n${question || 'What does this say?'}`;
  }
  if (references.startsWith(FROM_PHONE)) {
    return (
      `${references}\n\nAnswer the question from that. It is the user's own and is correct and up to date. ` +
      `Do not say you cannot see their calendar, reminders or location: it is above.\n\nQuestion: ${question}`
    );
  }
  return (
    "Reference material from the user's offline library follows. Each piece is headed by its source and title. " +
    'Use it to answer and to check your facts: where it covers the question, trust it over what you remember. ' +
    'Where it does not, answer from what you know. If you say where something comes from, name the source and ' +
    'title in words, such as "the Wikipedia article on Photosynthesis". Never mention numbers, brackets, an index ' +
    'or "the reference material".\n\n' +
    `${references}\n\nQuestion: ${question}`
  );
}
