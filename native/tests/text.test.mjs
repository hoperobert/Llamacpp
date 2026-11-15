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
