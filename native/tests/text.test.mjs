// Titles as small models actually write them, and what they should become.
import assert from 'node:assert/strict';
import { cleanTitle, isBrokenTitle, withoutThinking } from '../src/lib/text.ts';

const cases = [
  ['<think></think>Title: Hello', 'Hello'],                       // the case from the bug report
  ['<think>\nThe user said hi.\n</think>\n\nFriendly Greeting', 'Friendly Greeting'],
  ['Title: "Planning a Trip to Rome."', 'Planning a Trip to Rome'],
  ['**Vaccine Basics**', 'Vaccine Basics'],
  ['# Chess Study Plan\n\nThis title covers…', 'Chess Study Plan'],
  ['Chat title - Quick Dinner Ideas', 'Quick Dinner Ideas'],
  ['<think>still thinking and never finished', ''],
  ['</think>Weekend Plans', 'Weekend Plans'],
  ['<thinking>hmm</thinking>Budget Help', 'Budget Help'],
  ['', ''],
  ['Hi', ''],                                                     // too short to be a title
  ['x'.repeat(80), ''],                                           // a sentence, not a title
];
for (const [raw, expected] of cases) assert.equal(cleanTitle(raw), expected, JSON.stringify(raw));

assert.equal(withoutThinking('<think>plan</think>The summary.'), 'The summary.');
assert.equal(isBrokenTitle('<think></think>Title: Hell…'), true);
assert.equal(isBrokenTitle('Title: Something'), true);
assert.equal(isBrokenTitle('How Vaccines Work'), false);
assert.equal(isBrokenTitle('Subtitle: the sequel'), false);
console.log('ALL TITLE CHECKS PASSED');

// ---------- how the last run ended ----------
const { describeClose } = await import('../src/lib/session.ts');
const at = 1_000_000_000;
assert.equal(describeClose(null, at), '');
assert.equal(
  describeClose({ phase: 'active', since: at, doing: ['writing a reply'], model: 'Qwen3.5 4B', warnings: 0 }, at + 5000),
  'Last closed on screen: writing a reply, Qwen3.5 4B loaded',
);
assert.equal(
  describeClose({ phase: 'background', since: at, doing: [], model: 'Qwen3.5 4B', warnings: 2 }, at + 4 * 60000),
  'Last closed in the background: idle, Qwen3.5 4B loaded, 2 memory warnings. Reopened after 4 min',
);
assert.equal(
  describeClose({ phase: 'inactive', since: at, doing: ['loading a model'], model: null, warnings: 0 }, at + 20000),
  'Last closed in the background: loading a model, no model loaded. Reopened after under a minute',
);
console.log('session: all checks passed');

// ---------- slash commands ----------
const { COMMANDS, expandCommand, onOrOff, parseCommand, subjectOf, suggest } = await import('../src/lib/commands.ts');

// Every name and alias means one thing only.
const names = COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])]);
assert.equal(new Set(names).size, names.length, 'no two commands share a name');
assert.ok(names.every((name) => /^[a-z]+$/.test(name)));
for (const name of ['plan', 'goal', 'new', 'clear', 'model', 'compact', 'context', 'memory', 'help', 'config', 'resume', 'export']) {
  assert.ok(parseCommand(`/${name}`), `/${name} exists`);
}

assert.equal(parseCommand('/plan a trip to Rome').command.name, 'plan');
assert.equal(parseCommand('/plan a trip to Rome').arg, 'a trip to Rome');
assert.equal(parseCommand('  /TLDR  ').command.name, 'summarise', 'aliases and capitals are understood');
assert.equal(parseCommand('/summarize this\nand this').arg, 'this\nand this');
// Things that only look like commands are ordinary messages.
assert.equal(parseCommand('/usr/bin/env is where?'), null);
assert.equal(parseCommand('/nonsense'), null);
assert.equal(parseCommand('what does /plan do'), null);
assert.equal(parseCommand('/'), null);

// The list offered while typing.
assert.equal(suggest('/').length, COMMANDS.length, 'a slash alone lists everything');
assert.deepEqual(suggest('/pl').map((c) => c.name), ['plan']);
assert.deepEqual(suggest('/re').map((c) => c.name), ['rewrite', 'review', 'retry', 'rename', 'remember', 'chats']);
assert.deepEqual(suggest('/cl').map((c) => c.name), ['new'], 'found by its other name');
assert.deepEqual(suggest('/plan '), [], 'the list goes once the command is typed');
assert.deepEqual(suggest('hello'), []);
assert.deepEqual(suggest('/zz'), []);

// What the model is given.
assert.ok(expandCommand('/plan a trip to Rome').startsWith('Write a step-by-step plan for the following.'));
assert.ok(expandCommand('/plan a trip to Rome').endsWith('\n\na trip to Rome'));
assert.ok(expandCommand('/plan').includes('what we have been discussing'));
assert.equal(expandCommand('/translate French'), 'Translate your last reply into French. Reply with the translation only.');
assert.equal(expandCommand('/translate French good morning'), 'Translate the following into French. Reply with the translation only.\n\ngood morning');
assert.equal(expandCommand('/brainstorm'), '/brainstorm', 'nothing to write out without a topic');
assert.equal(expandCommand('/new'), '/new', 'a command that acts on the app is not a request');
assert.equal(expandCommand('Plan a trip'), 'Plan a trip');
for (const command of COMMANDS.filter((c) => c.prompt)) {
  assert.ok(command.prompt.with('X').includes('X'), `/${command.name} passes on what follows it`);
}

assert.equal(subjectOf('/plan a trip to Rome'), 'a trip to Rome');
assert.equal(subjectOf('/plan'), '/plan');
assert.equal(subjectOf('a trip to Rome'), 'a trip to Rome');

assert.equal(onOrOff('', true), false);
assert.equal(onOrOff('ON', false), true);
assert.equal(onOrOff('off', true), false);
assert.equal(onOrOff('maybe', true), null);
console.log('commands: all checks passed');

// ---------- context size ----------
const { bestContext, CONTEXT_STEPS, kvKBPerToken, trainedContext } = await import('../src/lib/context.ts');
const { MODELS } = await import('../src/lib/models.ts');

// Details as they are stored in real model files. The engine hands them over as text.
const qwen4b = {
  'general.architecture': 'qwen35', 'qwen35.block_count': '32', 'qwen35.context_length': '262144',
  'qwen35.embedding_length': '2560', 'qwen35.attention.head_count': '16', 'qwen35.attention.head_count_kv': '4',
  'qwen35.attention.key_length': '256', 'qwen35.attention.value_length': '256',
};
assert.equal(kvKBPerToken(qwen4b), 128);
assert.equal(trainedContext(qwen4b), 262144);
// A model whose layers do not all pay attention lists its heads layer by layer.
const lfm = {
  'general.architecture': 'lfm3', 'lfm3.block_count': 24, 'lfm3.embedding_length': 2048, 'lfm3.attention.head_count': 16,
  'lfm3.attention.head_count_kv': '[0, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0]',
  'lfm3.attention.key_length': 128, 'lfm3.attention.value_length': 128,
};
assert.equal(kvKBPerToken(lfm), 22);
assert.equal(kvKBPerToken({ ...lfm, 'lfm3.attention.head_count_kv': [0, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0] }), 22);
// With no key length given, it is the width shared between the heads.
assert.equal(kvKBPerToken({ 'general.architecture': 'llama', 'llama.block_count': 32, 'llama.embedding_length': 4096, 'llama.attention.head_count': 32, 'llama.attention.head_count_kv': 8 }), 128);
assert.equal(kvKBPerToken({}), null);
assert.equal(kvKBPerToken({ 'general.architecture': 'x' }), null);

assert.ok(MODELS.every((m) => m.kvKB > 0), 'every model in the catalogue says what its context costs');
const on = (id, ramMB, extra = false) => {
  const m = MODELS.find((model) => model.id === id);
  return bestContext({ fileMB: m.sizeMB, kvKB: m.kvKB, extraMB: extra ? m.vision.sizeMB : 0, ramMB });
};
// An 8 GB iPhone: small models get plenty, the 4B ones what they had, the heaviest less.
assert.equal(on('qwen35-2b', 7600), 8192);
assert.equal(on('qwen35-4b', 7600), 4096);
assert.equal(on('qwen35-4b', 7600, true), 4096, 'still fits with what lets it see photos');
assert.equal(on('spark-x26-4b', 7600), 3072);
assert.equal(on('dory10-4b', 7600), 2048, 'its context costs more than twice as much per token');
assert.equal(on('gemma4-e4b', 7600), 2048);
// The same model gets more on a bigger phone and less on a smaller one.
assert.equal(on('qwen35-4b', 5700), 2048);
assert.equal(on('qwen35-4b', 11400), 6144);
assert.equal(on('qwen35-4b', 15200), 8192);
for (const model of MODELS) {
  for (const ram of [3800, 5700, 7600, 11400, 15200]) {
    const size = on(model.id, ram);
    assert.ok(CONTEXT_STEPS.includes(size));
    assert.ok(size === 2048 || (size * model.kvKB) / 1024 <= ram * 0.07 + 1, `${model.id} on ${ram} MB keeps its context within bounds`);
    assert.ok(size <= on(model.id, ram * 2), 'more memory never means less context');
  }
}
// It never goes above what the model was made for.
assert.equal(bestContext({ fileMB: 500, kvKB: 20, ramMB: 15200, trained: 4096 }), 4096);
assert.equal(bestContext({ fileMB: 500, kvKB: 20, ramMB: null }), 8192);
assert.equal(bestContext({ fileMB: 3000, kvKB: 128, ramMB: null }), 2048, 'an unknown phone is treated as a small one');
console.log('context: all checks passed');

// ---------- taking turns ----------
const { takingTurns } = await import('../src/lib/text.ts');
assert.deepEqual(
  takingTurns([{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }, { role: 'assistant', content: 'c' }, { role: 'user', content: 'd' }]).map((m) => `${m.role}:${m.content}`),
  ['user:a\n\nb', 'assistant:c', 'user:d'],
);
assert.deepEqual(takingTurns([{ role: 'user', content: '', image: 'a.jpg' }, { role: 'user', content: 'what is this' }]), [{ role: 'user', content: 'what is this', image: 'a.jpg' }]);
assert.deepEqual(takingTurns([]), []);
console.log('turns: all checks passed');

// ---------- thinking that turns up in the reply ----------
const { splitThinking } = await import('../src/lib/text.ts');
// Gemma 4, as it appeared on the phone: its thinking in the reply, markers and all.
const gemma = '<|channel>thought\nThinking Process:\n\n1. **Analyze the Request:** The user wants to know what plant this is.\n<channel|>This looks like low-growing ground cover, but the photo is too blurry to name it.';
assert.deepEqual(splitThinking(gemma), {
  content: 'This looks like low-growing ground cover, but the photo is too blurry to name it.',
  reasoning: 'Thinking Process:\n\n1. **Analyze the Request:** The user wants to know what plant this is.',
});
// Still being written: the block is open, so there is no answer yet.
assert.deepEqual(splitThinking('<|channel>thought\nThinking Process:\n1. Analyze'), { content: '', reasoning: 'Thinking Process:\n1. Analyze' });
assert.deepEqual(splitThinking('<think>Let me see.</think>\n\nParis.'), { content: 'Paris.', reasoning: 'Let me see.' });
assert.deepEqual(splitThinking('<think>half a thought'), { content: '', reasoning: 'half a thought' });
// A model that starts out thinking only ever writes the closing marker.
assert.deepEqual(splitThinking('The user said hi.\n</think>\n\nHello!'), { content: 'Hello!', reasoning: 'The user said hi.' });
assert.deepEqual(splitThinking('First.<think>a</think> Second.<think>b</think>').reasoning, 'a\n\nb');
assert.deepEqual(splitThinking('Plain answer with a < b and x > y.'), { content: 'Plain answer with a < b and x > y.', reasoning: '' });
assert.equal(splitThinking('Done.<turn|>').content, 'Done.');
assert.equal(splitThinking('<|channel>final\nThe answer is 4.').content, 'The answer is 4.');
assert.equal(withoutThinking(gemma), 'This looks like low-growing ground cover, but the photo is too blurry to name it.');
console.log('thinking: all checks passed');

// ---------- running code ----------
const { runnable, runnerPage, outputText, reportFor, failed } = await import('../src/lib/runner.ts');
assert.equal(runnable('js', 'console.log(1)'), 'script');
assert.equal(runnable('JavaScript', 'console.log(1)'), 'script');
assert.equal(runnable('html', '<p>hi</p>'), 'page');
assert.equal(runnable('svg', '<svg></svg>'), 'page');
assert.equal(runnable('', '<!DOCTYPE html>\n<html></html>'), 'page');
assert.equal(runnable('', 'console.log(1)'), null);                 // no language named: not guessed at
assert.equal(runnable('python', 'print(1)'), null);
assert.equal(runnable('ts', 'const a: number = 1'), null);
assert.equal(runnable('js', '   '), null);
// Code that mentions "</script>" must not end the script it is carried in.
const carried = runnerPage('script', 'console.log("</script><script>alert(1)</script>")');
assert.equal(carried.split('</script>').length, 3);                 // the bridge's and the runner's own, no more
assert.ok(carried.includes("default-src 'none'"));
// A page of the model's own keeps its doctype first, with the no-internet rule ahead of everything else in it.
const shown = runnerPage('page', '<!DOCTYPE html>\n<html><head><script src="https://example.com/x.js"></script></head></html>');
assert.ok(shown.startsWith('<!DOCTYPE html><meta http-equiv="Content-Security-Policy"'));
assert.ok(shown.indexOf('Content-Security-Policy') < shown.indexOf('example.com'));
assert.ok(runnerPage('page', '<p>hi</p>').startsWith('<!doctype html><meta'));
assert.ok(runnerPage('page', '<svg width="10"></svg>').includes('place-items:center'));
const printed = [{ kind: 'log', text: '1' }, { kind: 'log', text: '2' }, { kind: 'done', text: '' }];
assert.equal(outputText(printed), '1\n2');
assert.equal(outputText([{ kind: 'log', text: 'x'.repeat(50) }], 10), `…${'x'.repeat(10)}`);
assert.equal(failed(printed), false);
assert.equal(reportFor(printed), 'I ran the code. It printed:\n\n```\n1\n2\n```');
assert.equal(reportFor([]), 'I ran the code. It printed nothing.');
const broke = [{ kind: 'error', text: 'ReferenceError: x is not defined' }];
assert.equal(failed(broke), true);
assert.ok(reportFor(broke).startsWith('I ran the code and it went wrong. Fix it.'));
console.log('running code: all checks passed');

// ---------- files and photo text given to the model ----------
const { fileText, withReferences, FROM_FILE, FROM_PHOTO, FROM_PHONE } = await import('../src/lib/retrieval.ts');
const small = fileText('notes.txt', 'One.\r\n\r\n\r\n\r\nTwo.  \nThree.', 1000);
assert.deepEqual(small, { context: `${FROM_FILE} notes.txt\n\nOne.\n\nTwo.\nThree.`, whole: true });
const big = fileText('book.pdf', 'x'.repeat(5000), 1000);
assert.equal(big.whole, false);
assert.ok(big.context.length < 1200 && big.context.endsWith('Only its first part is here.)'));
// With nothing typed, the file is summarised. The library's wording is kept for the library.
assert.ok(withReferences('', small.context).endsWith('Summarise this file.'));
assert.ok(withReferences('Who wrote it?', small.context).endsWith('Who wrote it?'));
assert.ok(!withReferences('Who wrote it?', small.context).includes('offline library'));
assert.ok(withReferences('', `${FROM_PHOTO}\n\nNo parking`).endsWith('What does this say?'));
assert.ok(withReferences('Am I free?', `${FROM_PHONE}\nNo events.`).includes('Do not say you cannot see'));
assert.ok(withReferences('What is a cell?', 'Source: Wikipedia\nTitle: Cell\n\nA cell is…').includes('offline library'));
console.log('files: all checks passed');
