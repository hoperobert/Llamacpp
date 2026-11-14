// Fills the old key-value store the way builds 1-4 saved things, then opens the
// app's real database code and checks everything came across.
import { data } from './mocks/storage.mjs';
import assert from 'node:assert/strict';

const chatA = {
  id: 'a1', title: 'Trip to Rome', updatedAt: 2000, summary: 'They planned a trip.', cut: 2,
  ctx: { used: 321, cut: 2, count: 4 },
  messages: [
    { role: 'user', content: 'Plan a trip to Rome' },                      // old messages had no id
    { role: 'assistant', content: 'Day 1: the Colosseum.', reasoning: 'thinking…', speed: 21.5 },
    { role: 'user', content: "It's 3 days, and I'm vegetarian" },
    { role: 'assistant', content: 'Here is a revised plan with "quotes" and an emoji 🍝.' },
  ],
};
const chatB = { id: 'b2', title: 'Shopping list', updatedAt: 1000, summary: '', cut: 0, ctx: null,
  messages: [{ role: 'user', content: 'Milk, eggs' }, { role: 'assistant', content: 'Noted.' }] };
data.set('chats', JSON.stringify([
  { id: 'a1', title: 'Trip to Rome', updatedAt: 2000, pinned: true },
  { id: 'b2', title: 'Shopping list', updatedAt: 1000 },
  { id: 'gone', title: 'Listed but its body is missing', updatedAt: 500 },
]));
data.set('chat:a1', JSON.stringify(chatA));
data.set('chat:b2', JSON.stringify(chatB));
data.set('memories', JSON.stringify([{ id: 'm1', text: 'User is vegetarian' }, { id: 'm2', text: 'User lives in Leeds' }]));
data.set('settings', JSON.stringify({ theme: 'dark' }));   // must be left alone

const { chatStore, memoryStore, projectStore } = await import('../src/lib/db.ts');

const list = await chatStore.chatList();
assert.deepEqual(list.map((c) => c.id), ['a1', 'b2'], 'both chats listed, newest first, missing one skipped');
assert.equal(list[0].pinned, true, 'pin carried over from the old list');

const a = await chatStore.chat('a1');
assert.equal(a.title, 'Trip to Rome');
assert.equal(a.summary, 'They planned a trip.');
assert.equal(a.cut, 2);
assert.deepEqual(a.ctx, { used: 321, cut: 2, count: 4 });
assert.equal(a.messages.length, 4);
assert.deepEqual(a.messages.map((m) => m.content), chatA.messages.map((m) => m.content), 'message text and order kept');
assert.equal(a.messages[1].reasoning, 'thinking…');
assert.equal(a.messages[1].speed, 21.5);
assert.ok(a.messages.every((m) => m.id), 'old messages were given ids');

const memories = await memoryStore.all();
assert.deepEqual(memories.map((m) => ({ ...m })), [{ id: 'm1', text: 'User is vegetarian' }, { id: 'm2', text: 'User lives in Leeds' }], 'memories kept in order');

assert.deepEqual([...data.keys()].sort(), ['settings'], 'old copies removed, settings untouched');

// Normal use afterwards.
assert.deepEqual((await chatStore.searchChats('vegetarian')).map((c) => c.id), ['a1'], 'search finds text inside a message');
await chatStore.saveChat({ ...a, messages: [...a.messages, { id: 'n1', role: 'user', content: 'Thanks', image: 'images/x.jpg' }], updatedAt: 3000, projectId: undefined });
assert.equal((await chatStore.chat('a1')).messages[4].image, 'images/x.jpg', 'a photo name is stored with its message');
await projectStore.saveProject({ id: 'p1', name: 'Travel', instructions: 'Be brief' });
await chatStore.updateChat('a1', { projectId: 'p1' });
assert.equal((await chatStore.chatList())[0].projectId, 'p1');
await projectStore.deleteProject('p1');
assert.equal((await chatStore.chatList())[0].projectId, undefined, 'deleting a project keeps its chats');
// Two saves at once must not collide.
await Promise.all([chatStore.saveChat({ ...chatB, updatedAt: 4000 }), chatStore.saveChat({ ...a, updatedAt: 5000 })]);
assert.deepEqual((await chatStore.chatList()).map((c) => c.id), ['a1', 'b2']);
await chatStore.deleteChat('b2');
assert.equal(await chatStore.chat('b2'), null);
console.log('ALL CHECKS PASSED');
