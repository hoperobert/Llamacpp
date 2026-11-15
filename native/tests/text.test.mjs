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
