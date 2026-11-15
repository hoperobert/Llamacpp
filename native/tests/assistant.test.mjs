// Plain requests, and what the app should take them to mean.
import assert from 'node:assert/strict';
import { findAction, findLookup, findWhen, sayWhen, sayFor, describeAction } from '../src/lib/assistant.ts';

// Sunday 15 November 2026, 17:20, wherever the tests run.
const now = new Date(2026, 10, 15, 17, 20, 0).getTime();
const at = (...parts) => new Date(...parts).getTime();
const when = (text) => { const w = findWhen(text, now); return w && [new Date(w.at).toString().slice(0, 21), w.rest]; };
const stamp = (y, mo, d, h, mi) => new Date(y, mo, d, h, mi).toString().slice(0, 21);

assert.deepEqual(when('call the dentist tomorrow at 9'), [stamp(2026, 10, 16, 9, 0), 'call the dentist']);
assert.deepEqual(when('in 20 minutes take the bread out'), [stamp(2026, 10, 15, 17, 40), 'take the bread out']);
assert.deepEqual(when('check the oven in half an hour'), [stamp(2026, 10, 15, 17, 50), 'check the oven']);
assert.deepEqual(when('ring Sam in an hour and a half'), [stamp(2026, 10, 15, 18, 50), 'ring Sam']);
assert.deepEqual(when('pay rent on Friday'), [stamp(2026, 10, 20, 9, 0), 'pay rent']);
assert.deepEqual(when('dinner with Ana next sunday at 7:30pm'), [stamp(2026, 10, 22, 19, 30), 'dinner with Ana']);
assert.deepEqual(when('take pills at 9pm'), [stamp(2026, 10, 15, 21, 0), 'take pills']);
assert.deepEqual(when('take pills at 9'), [stamp(2026, 10, 15, 21, 0), 'take pills']);        // the next 9 o'clock
assert.deepEqual(when('stand-up at 9am'), [stamp(2026, 10, 16, 9, 0), 'stand-up']);            // gone by today
assert.deepEqual(when('put the bins out tonight'), [stamp(2026, 10, 15, 19, 0), 'put the bins out']);
assert.deepEqual(when('film tonight at 8'), [stamp(2026, 10, 15, 20, 0), 'film']);
assert.deepEqual(when('renew passport on 3 December'), [stamp(2026, 11, 3, 9, 0), 'renew passport']);
assert.deepEqual(when('party on March 4th at noon'), [stamp(2027, 2, 4, 12, 0), 'party']);      // next year's
assert.deepEqual(when('lunch at 13:15'), [stamp(2026, 10, 16, 13, 15), 'lunch']);
assert.deepEqual(when('meet at 18:00'), [stamp(2026, 10, 15, 18, 0), 'meet']);
assert.deepEqual(when('go for a run tomorrow morning'), [stamp(2026, 10, 16, 9, 0), 'go for a run']);
assert.equal(when('buy milk'), null);
assert.equal(when('what happened in 1066'), null);
console.log('assistant: times read correctly');

const act = (text) => findAction(text, now);
assert.deepEqual(act('Remind me to call the dentist tomorrow at 9'), { kind: 'reminder', title: 'Call the dentist', at: at(2026, 10, 16, 9, 0) });
assert.deepEqual(act('remind me in 20 minutes to take the bread out'), { kind: 'reminder', title: 'Take the bread out', at: at(2026, 10, 15, 17, 40) });
assert.deepEqual(act('Please remind me to buy milk.'), { kind: 'reminder', title: 'Buy milk', at: null });
assert.deepEqual(act('remind me about the MOT on Friday'), { kind: 'reminder', title: 'The MOT', at: at(2026, 10, 20, 9, 0) });
assert.deepEqual(act('set a reminder to water the plants at 8pm'), { kind: 'reminder', title: 'Water the plants', at: at(2026, 10, 15, 20, 0) });
assert.deepEqual(act('add eggs to my reminders'), { kind: 'reminder', title: 'Eggs', at: null });
assert.deepEqual(act('Set a timer for 10 minutes'), { kind: 'timer', title: 'Timer', at: now + 10 * 60000 });
assert.deepEqual(act('set a 25 minute timer'), { kind: 'timer', title: 'Timer', at: now + 25 * 60000 });
assert.deepEqual(act('start a pasta timer for 9 minutes'), { kind: 'timer', title: 'Pasta', at: now + 9 * 60000 });
assert.deepEqual(act('timer 45 seconds'), null);                                                    // no "for": left to the model
assert.deepEqual(act('timer for 45 seconds'), { kind: 'timer', title: 'Timer', at: now + 45000 });
assert.deepEqual(act('Add dinner with Ana to my calendar on Friday at 7pm'), { kind: 'event', title: 'Dinner with Ana', at: at(2026, 10, 20, 19, 0), minutes: 60 });
assert.deepEqual(act('schedule a dentist appointment tomorrow at 2:30pm for 30 minutes'), { kind: 'event', title: 'Dentist appointment', at: at(2026, 10, 16, 14, 30), minutes: 30 });
assert.deepEqual(act('add a meeting with the bank on 3 December at 10 for 2 hours'), { kind: 'event', title: 'With the bank', at: at(2026, 11, 3, 10, 0), minutes: 120 });
assert.deepEqual(act("Text Mum I'm running late"), { kind: 'message', to: 'Mum', body: "I'm running late" });
assert.deepEqual(act('text John Smith see you at 8'), { kind: 'message', to: 'John Smith', body: 'See you at 8' });
assert.deepEqual(act('message Ana saying happy birthday!'), { kind: 'message', to: 'Ana', body: 'Happy birthday' });
assert.deepEqual(act('send a text to my sister: call me'), { kind: 'message', to: 'Sister', body: 'Call me' });
assert.deepEqual(act('email Priya about the invoice'), { kind: 'email', to: 'Priya', subject: 'The invoice', body: '' });
assert.deepEqual(act('Call mum'), { kind: 'call', to: 'Mum' });
assert.deepEqual(act('ring Dr Patel'), { kind: 'call', to: 'Dr Patel' });
assert.deepEqual(act('Directions to Kings Cross station'), { kind: 'directions', to: 'Kings Cross station' });
assert.deepEqual(act('how do I get to the British Museum?'), { kind: 'directions', to: 'The British Museum' });
assert.deepEqual(act('take me to the nearest petrol station'), { kind: 'directions', to: 'The nearest petrol station' });
// Questions and chat that only sound like requests stay with the model.
for (const text of [
  'What is a reminder in iOS?', 'How do timers work in JavaScript?', 'Call it a day?', 'call me when you get this meaning',
  'Explain how email works', 'Write a text message to my landlord about the boiler', 'schedule', 'Text',
  'Why do people set reminders?', 'Tell me about the calendar the Romans used', 'directions', 'Remind me what a noun is tomorrow\nand more',
]) assert.equal(act(text), null, text);
console.log('assistant: requests read correctly');

const look = (text) => findLookup(text, now);
assert.deepEqual(look("What's on my calendar today?"), { kind: 'calendar', from: now, to: at(2026, 10, 16), label: 'today' });
assert.deepEqual(look('do I have anything tomorrow'), { kind: 'calendar', from: at(2026, 10, 16), to: at(2026, 10, 17), label: 'tomorrow' });
assert.equal(look('Am I free on Friday?').label, 'Fri Nov 20 2026');
assert.equal(look('what does my schedule look like this week').label, 'the next seven days');
assert.deepEqual(look('what are my reminders'), { kind: 'reminders' });
assert.deepEqual(look('Where am I?'), { kind: 'location' });
assert.deepEqual(look('coffee shops near me'), { kind: 'location' });
assert.equal(look('Who invented the calendar?'), null);
assert.equal(look('What is the capital of France?'), null);
console.log('assistant: questions about the phone read correctly');

assert.equal(sayWhen(at(2026, 10, 16, 9, 0), now), 'Tomorrow at 09:00');
assert.equal(sayWhen(at(2026, 10, 15, 21, 5), now), 'Today at 21:05');
assert.equal(sayWhen(at(2026, 10, 20, 19, 0), now), 'Friday 20 November at 19:00');
assert.equal(sayWhen(at(2027, 2, 4, 12, 0), now), 'Thursday 4 March 2027 at 12:00');
assert.equal(sayFor(25 * 60000), '25 minutes');
assert.equal(sayFor(90 * 60000), '1 hour 30 minutes');
assert.equal(sayFor(45000), '45 seconds');
assert.deepEqual(describeAction(act('Set a timer for 10 minutes'), now), { title: 'Timer', detail: '10 minutes, until 17:30', approve: 'Start timer' });
assert.deepEqual(describeAction(act('Remind me to buy milk'), now), { title: 'Reminder: Buy milk', detail: 'No time set', approve: 'Add reminder' });
console.log('assistant: all checks passed');
