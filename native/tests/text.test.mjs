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
