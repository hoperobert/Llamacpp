import { Engine, MODELS, diagnostics, isIOS, previousCrash, modeKey } from './engine.js';
import { store, newId } from './store.js';
import { renderMarkdown } from './markdown.js';

const DEFAULTS = {
  modelId: MODELS[0].id,
  instructions: '',
  temperature: 0.7,
  maxTokens: 768,
  nCtx: isIOS ? 2048 : 4096,   // phones have far less memory to spare
  thinking: false,
  gpu: true,
  pendingModelId: null,   // a download to resume when the app next opens
  loadMode: null,
  badModes: [],     // load modes that crashed the browser on this device   // the load mode that last worked on this device
  memoryOn: true,
  autoMemory: true,
  autoSummary: true,
  theme: 'auto',
  textSize: 'm',
};

const SUGGESTIONS = [
  'Explain how vaccines work in simple terms',
  'Write a friendly text to reschedule dinner',
  'Give me a 3-day plan to learn the basics of chess',
];

const KEEP_RECENT = 4;        // messages left untouched when a chat is compacted
const MAX_MEMORIES = 40;
const MEMORY_PROMPT_CHARS = 1500;
// Only messages that look like they contain a personal fact are checked for
// memories, because each check costs an extra model run.
const MEMORY_TRIGGER = /\b(my name is|call me|i am|i'm|i live|i work|i study|i like|i love|i hate|i prefer|i don't|i can't|i have|i own|i speak|my [\w' -]{2,30} (is|are)|remember that)\b/i;

const MEMORY_SYSTEM =
  'You extract lasting personal facts about the user from one message: name, location, job, ' +
  'family, pets, tastes, needs. Write each as a short sentence starting with "User". Ignore ' +
  'questions, requests and things that are only true today. If there is nothing lasting, ' +
  'return an empty list.';
const MEMORY_SCHEMA = {
  type: 'object',
  properties: { facts: { type: 'array', items: { type: 'string' }, maxItems: 3 } },
  required: ['facts'],
};
const FACT_FILLER = new Set(['user', 'users', 'the', 'and', 'has', 'have', 'had', 'with', 'for',
  'that', 'this', 'are', 'was', 'not', 'from', 'named', 'called', 'name', 'lives', 'live',
  'works', 'work', 'likes', 'like', 'their', 'they', 'who']);
const words = (text) => text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];

/**
 * Small models sometimes invent facts or restate the request. Keep a fact only
 * if it is about the user and most of its key words appear in the message.
 */
function isUsefulFact(fact, message) {
  if (typeof fact !== 'string' || !/^user\b/i.test(fact.trim())) return false;
  if (/\b(requests?|asks?|asked|wants? (a|an|to know)|not specified|unknown|has no)\b/i.test(fact)) return false;
  const said = new Set(words(message));
  const key = words(fact).filter((w) => !FACT_FILLER.has(w));
  if (!key.length) return false;
  const grounded = key.filter((w) => said.has(w) || said.has(w.replace(/s$/, ''))).length;
  return grounded >= Math.ceil(key.length / 2);
}

const $ = (id) => document.getElementById(id);
const engine = new Engine();

let settings = { ...DEFAULTS };
let memories = [];
let chats = [];
let chat = null;
let cached = new Set();
let partials = new Map();   // model id -> { loaded, total } for unfinished downloads
let busy = false;
let abortController = null;
let reloadNeeded = false;
const modelUi = { loadingId: null, phase: '', fraction: 0, text: '', errorId: null, error: '' };

// ====================================================================
// Helpers
// ====================================================================

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== false && value != null) node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}

const ICONS = {
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
};

const formatMB = (mb) => (mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`);
const estimateTokens = (text) => Math.ceil(text.length / 3) + 6;
const saveSettings = () => store.setValue('settings', settings).catch(console.warn);
const saveMemories = () => store.setValue('memories', memories).catch(console.warn);

function setStatus(text) { $('status').textContent = text; }

let toastTimer = null;
function toast(text, actionLabel, action) {
  $('toastText').textContent = text;
  const button = $('toastAction');
  button.hidden = !actionLabel;
  button.textContent = actionLabel || '';
  button.onclick = () => { action?.(); $('toast').hidden = true; };
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, actionLabel ? 6000 : 3000);
}

/** A styled replacement for confirm(). Resolves true when the user agrees. */
function confirmDialog(message, confirmLabel = 'Delete') {
  return new Promise((resolve) => {
    const dialog = $('confirmDialog');
    $('confirmText').textContent = message;
    $('confirmOk').textContent = confirmLabel;
    const finish = (answer) => {
      $('confirmOk').onclick = $('confirmCancel').onclick = dialog.onclose = null;
      if (dialog.open) dialog.close();
      resolve(answer);
    };
    $('confirmOk').onclick = () => finish(true);
    $('confirmCancel').onclick = () => finish(false);
    dialog.onclose = () => finish(false);
    dialog.showModal();
  });
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    if (button) {
      const original = button.innerHTML;
      button.innerHTML = ICONS.check;
      setTimeout(() => { button.innerHTML = original; }, 1200);
    } else {
      toast('Copied');
    }
  } catch (e) {
    toast('Could not copy');
  }
}

function friendlyError(e) {
  const text = String(e?.message || e);
  if (/context|exceed|kv.?cache/i.test(text)) {
    return 'This chat no longer fits in the context. Start a new chat, or raise the context size in Settings.';
  }
  if (/memory|alloc|OOM/i.test(text)) {
    return 'The device ran out of memory. Try the smaller model or a smaller context size.';
  }
  return `Something went wrong: ${text}`;
}

// ====================================================================
// Chats
// ====================================================================

function blankChat() {
  return {
    id: newId(), title: 'New chat', messages: [], summary: '', cut: 0, ctx: null,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

async function saveChat() {
  if (!chat.messages.length) return;
  chat.updatedAt = Date.now();
  if (!chats.some((c) => c.id === chat.id)) chats.unshift(chat);
  chats.sort((a, b) => b.updatedAt - a.updatedAt);
  await store.saveChat(chat).catch(console.warn);
  renderChatList();
}

function openChat(next) {
  if (busy) abortController?.abort();
  chat = next;
  renderAll();
}

async function deleteChat(id) {
  chats = chats.filter((c) => c.id !== id);
  await store.deleteChat(id).catch(console.warn);
  if (chat.id === id) openChat(blankChat());
  else renderChatList();
}

// ====================================================================
// Context handling
// ====================================================================

function systemPrompt() {
  const parts = [
    "You are a helpful assistant running privately on the user's own device. " +
    `Keep answers clear and concise. Today is ${new Date().toDateString()}.`,
  ];
  if (settings.instructions.trim()) {
    parts.push(`Follow these instructions from the user:\n${settings.instructions.trim()}`);
  }
  if (settings.memoryOn && memories.length) {
    const lines = [];
    let used = 0;
    for (const m of [...memories].reverse()) {
      if (used + m.text.length > MEMORY_PROMPT_CHARS) break;
      used += m.text.length;
      lines.unshift(`- ${m.text}`);
    }
    parts.push(`Facts about the user, the person you are talking to. Use them when relevant:\n${lines.join('\n')}`);
  }
  if (chat.summary) {
    parts.push(`Summary of the earlier part of this conversation:\n${chat.summary}`);
  }
  return parts.join('\n\n');
}

function promptMessages() {
  return [
    { role: 'system', content: systemPrompt() },
    ...chat.messages.slice(chat.cut).filter((m) => m.content)
      .map(({ role, content }) => ({ role, content })),
  ];
}

/** Tokens the current chat occupies. Measured where possible, else estimated. */
function usedTokens() {
  const live = chat.messages.slice(chat.cut);
  if (chat.ctx && chat.ctx.cut === chat.cut && chat.ctx.count <= chat.messages.length) {
    const added = chat.messages.slice(chat.ctx.count);
    return chat.ctx.used + added.reduce((n, m) => n + estimateTokens(m.content), 0);
  }
  return estimateTokens(systemPrompt()) + live.reduce((n, m) => n + estimateTokens(m.content), 0);
}

const contextSize = () => engine.nCtx || settings.nCtx;
const replyBudget = () => Math.min(settings.maxTokens, Math.floor(contextSize() / 2));

/**
 * Frees context by folding the oldest messages into a summary (or dropping
 * them, when summaries are off). Returns false if nothing could be freed.
 */
async function compact({ signal, keep = KEEP_RECENT } = {}) {
  const end = chat.messages.length - Math.min(keep, chat.messages.length - 1);
  const old = chat.messages.slice(chat.cut, end);
  if (!old.length) return false;

  if (settings.autoSummary && engine.ready) {
    setStatus('Summarising earlier messages…');
    const budgetChars = Math.floor(contextSize() * 1.2);
    let transcript = old
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 700)}`)
      .join('\n');
    if (transcript.length > budgetChars) transcript = transcript.slice(-budgetChars);
    try {
      const summary = await engine.complete([
        {
          role: 'system',
          content: 'You compress conversations. Write one summary under 120 words. Keep names, ' +
            'facts, decisions and unanswered questions. Reply with the summary only.',
        },
        {
          role: 'user',
          content: (chat.summary ? `Summary so far:\n${chat.summary}\n\n` : '') +
            `New messages:\n${transcript}`,
        },
      ], { maxTokens: 220, signal });
      if (summary.trim()) chat.summary = summary.trim();
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      console.warn('Summary failed, dropping old messages instead', e);
    }
  }

  chat.cut = end;
  chat.ctx = null;
  await saveChat();
  renderMessages();
  renderContext();
  return true;
}

async function ensureRoom(signal) {
  const limit = contextSize() - replyBudget() - 48;
  let keep = KEEP_RECENT;
  for (let i = 0; i < 4 && usedTokens() > limit; i++) {
    if (!(await compact({ signal, keep }))) break;
    keep = Math.max(1, keep - 2);
  }
}

function renderContext() {
  const button = $('ctxBtn');
  button.hidden = !chat.messages.length;
  const pct = Math.min(100, Math.round((usedTokens() / contextSize()) * 100));
  $('ctxRing').setAttribute('stroke-dasharray', `${pct} 100`);
  $('ctxPct').textContent = pct;
  button.classList.toggle('high', pct >= 75);
  button.setAttribute('aria-label', `Context ${pct}% used`);
}

// ====================================================================
// Memories
// ====================================================================

function addMemory(text, { quiet = false } = {}) {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, 160);
  if (clean.length < 3) return false;
  const key = clean.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '');
  const duplicate = memories.some((m) => {
    const other = m.text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '');
    return other === key || other.includes(key) || key.includes(other);
  });
  if (duplicate) return false;
  const memory = { id: newId(), text: clean, createdAt: Date.now() };
  memories.push(memory);
  if (memories.length > MAX_MEMORIES) memories.shift();
  saveMemories();
  renderMemories();
  if (!quiet) {
    toast(`Saved to memory: ${clean}`, 'Undo', () => removeMemory(memory.id));
  }
  return true;
}

function removeMemory(id) {
  memories = memories.filter((m) => m.id !== id);
  saveMemories();
  renderMemories();
}

async function extractMemories(userText, signal) {
  if (!settings.memoryOn || !settings.autoMemory) return;
  if (userText.length > 600 || !MEMORY_TRIGGER.test(userText)) return;
  setStatus('Checking for things to remember…');
  try {
    const raw = await engine.complete([
      { role: 'system', content: MEMORY_SYSTEM },
      {
        role: 'user',
        content: `Message: """${userText}"""\n\nList the lasting facts about the user.`,
      },
    ], { maxTokens: 120, signal, schema: MEMORY_SCHEMA });
    const facts = JSON.parse(raw).facts || [];
    const saved = facts.filter((f) => isUsefulFact(f, userText) && addMemory(f, { quiet: true }));
    if (saved.length) {
      const ids = memories.slice(-saved.length).map((m) => m.id);
      toast(
        saved.length === 1 ? `Saved to memory: ${saved[0].trim()}` : `Saved ${saved.length} memories`,
        'Undo',
        () => ids.forEach(removeMemory)
      );
    }
  } catch (e) {
    if (e?.name !== 'AbortError') console.warn('Memory extraction failed', e);
  }
}

function renderMemories() {
  const list = $('memoryList');
  if (!memories.length) {
    list.replaceChildren(h('li', { class: 'none' }, 'Nothing saved yet.'));
    return;
  }
  list.replaceChildren(...memories.map((m) =>
    h('li', {},
      h('span', {}, m.text),
      h('button', { type: 'button', 'aria-label': 'Delete memory', html: ICONS.close, onclick: () => removeMemory(m.id) })
    )
  ));
}

// ====================================================================
// Generating a reply
// ====================================================================

async function send(text) {
  const remember = text.match(/^\/remember\s+(.+)/is);
  if (remember) {
    if (!addMemory(remember[1])) toast('Already in memory.');
    return;
  }
  if (!chat.messages.length) chat.title = text.replace(/\s+/g, ' ').slice(0, 48);
  chat.messages.push({ role: 'user', content: text });
  await saveChat();
  renderAll();
  await runTurn(text);
}

async function regenerate() {
  if (busy || !engine.ready) return;
  const last = chat.messages[chat.messages.length - 1];
  if (last?.role !== 'assistant') return;
  chat.messages.pop();
  chat.ctx = null;
  renderMessages();
  await runTurn(null);
}

async function runTurn(userText) {
  busy = true;
  abortController = new AbortController();
  const { signal } = abortController;
  renderComposer();

  const message = { role: 'assistant', content: '', reasoning: '' };
  const view = messageView(message, { streaming: true });
  $('messages').append(view.node);
  scrollToEnd(true);

  let timings = null;
  let tokens = 0;
  let firstAt = 0;
  let frame = 0;
  const paint = () => {
    frame = 0;
    view.update(message, true);
    scrollToEnd();
  };

  try {
    await ensureRoom(signal);
    // Compacting redraws the list, which removes the reply placeholder.
    if (!view.node.isConnected) $('messages').append(view.node);
    setStatus('');
    const stream = engine.chat(promptMessages(), {
      temperature: settings.temperature,
      maxTokens: replyBudget(),
      thinking: settings.thinking,
      signal,
    });
    for await (const part of stream) {
      if (part.timings !== undefined) { timings = part.timings; continue; }
      message.content += part.content;
      message.reasoning += part.reasoning;
      tokens++;
      if (!firstAt) firstAt = performance.now();
      if (!frame) frame = requestAnimationFrame(paint);
      if (tokens > 4) {
        const seconds = (performance.now() - firstAt) / 1000;
        setStatus(`${((tokens - 1) / seconds).toFixed(1)} tokens/s`);
      }
    }
  } catch (e) {
    if (e?.name !== 'AbortError') {
      console.error(e);
      message.error = friendlyError(e);
    }
  }
  cancelAnimationFrame(frame);

  if (tokens) {
    const seconds = (performance.now() - firstAt) / 1000;
    message.speed = timings?.predicted_per_second || (seconds > 0 ? (tokens - 1) / seconds : 0);
  }
  message.content = message.content.trim();
  if (!message.reasoning) delete message.reasoning;

  if (message.content) {
    chat.messages.push(message);
    chat.ctx = timings
      ? {
          used: (timings.cache_n || 0) + (timings.prompt_n || 0) + (timings.predicted_n || 0),
          cut: chat.cut,
          count: chat.messages.length,
        }
      : null;
    await saveChat();
  }
  renderMessages(message.content ? null : message);
  renderContext();
  setStatus('');

  if (message.content && userText && !signal.aborted) {
    await extractMemories(userText, signal);
    setStatus('');
  }

  busy = false;
  abortController = null;
  renderComposer();
}

// ====================================================================
// Rendering
// ====================================================================

function messageView(message, { streaming = false, last = false, index = -1 } = {}) {
  const node = h('div', { class: `msg ${message.role}` });
  const bubble = h('div', { class: 'bubble' });
  node.append(bubble);

  const update = (m, live) => {
    if (m.role === 'user') {
      bubble.textContent = m.content;
      return;
    }
    if (live && !m.content && !m.reasoning) {
      bubble.replaceChildren(h('span', { class: 'typing', 'aria-label': 'Working' },
        h('i'), h('i'), h('i')));
      return;
    }
    const parts = [];
    if (m.reasoning) {
      parts.push(h('details', { class: 'think', open: live && !m.content },
        h('summary', {}, live && !m.content ? 'Thinking…' : 'Thought process'),
        h('div', {}, m.reasoning.trim())
      ));
    }
    const body = h('div', { html: renderMarkdown(m.content) });
    if (live) {
      (body.lastElementChild || body).classList.add('cursor');
    } else {
      for (const pre of body.querySelectorAll('pre')) {
        const code = pre.textContent;
        const button = h('button', {
          class: 'copy-code', type: 'button', 'aria-label': 'Copy code', html: ICONS.copy,
        });
        button.addEventListener('click', () => copyText(code, button));
        const wrap = h('div', { class: 'code' });
        pre.replaceWith(wrap);
        wrap.append(pre, button);
      }
    }
    parts.push(body);
    bubble.replaceChildren(...parts);
  };
  update(message, streaming);

  if (message.error) {
    node.append(h('div', { class: 'error' },
      message.error,
      h('button', { class: 'text-btn', type: 'button', onclick: retryLast }, 'Try again')
    ));
  }

  if (message.role === 'user' && !streaming && index >= 0 && index === lastUserIndex()) {
    node.append(h('div', { class: 'msg-foot' },
      h('button', {
        type: 'button', 'aria-label': 'Edit message', html: ICONS.edit,
        onclick: () => editMessage(index),
      })
    ));
  }

  if (message.role === 'assistant' && !streaming && message.content) {
    const copy = h('button', { type: 'button', 'aria-label': 'Copy', html: ICONS.copy });
    copy.addEventListener('click', () => copyText(message.content, copy));
    node.append(h('div', { class: 'msg-foot' },
      copy,
      last && h('button', { type: 'button', 'aria-label': 'Try again', html: ICONS.redo, onclick: regenerate }),
      message.speed ? h('span', { class: 'speed' }, `${message.speed.toFixed(1)} tokens/s`) : null
    ));
  }
  return { node, update };
}

const lastUserIndex = () => chat.messages.map((m) => m.role).lastIndexOf('user');

/** Puts a sent message back in the box and removes it and everything after it. */
async function editMessage(index) {
  if (busy) return;
  const text = chat.messages[index].content;
  chat.messages.splice(index);
  chat.ctx = null;
  if (chat.cut > chat.messages.length) { chat.cut = 0; chat.summary = ''; }
  if (chat.messages.length) {
    await saveChat();
  } else {
    chats = chats.filter((c) => c.id !== chat.id);
    await store.deleteChat(chat.id).catch(console.warn);
    chat.title = 'New chat';
  }
  renderAll();
  $('input').value = text;
  autoGrow();
  renderComposer();
  $('input').focus();
}

/** Asks again after a failed reply. The last message is the unanswered one. */
function retryLast() {
  if (busy || !engine.ready) return;
  if (chat.messages[chat.messages.length - 1]?.role !== 'user') return;
  renderMessages();
  runTurn(null);
}

/** Rebuilds the message list. `failed` is an unsaved message to show at the end. */
function renderMessages(failed = null) {
  const nodes = [];
  chat.messages.forEach((m, i) => {
    if (chat.cut > 0 && i === chat.cut) {
      nodes.push(h('div', { class: 'divider' },
        chat.summary ? 'Earlier messages summarised' : 'Earlier messages are out of context'));
    }
    nodes.push(messageView(m, { last: i === chat.messages.length - 1 && !failed, index: i }).node);
  });
  if (failed && (failed.content || failed.error)) nodes.push(messageView(failed).node);
  $('messages').replaceChildren(...nodes);
  renderVisibility();
}

function greeting() {
  const hour = new Date().getHours();
  return hour < 5 ? 'Up late?' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

function renderVisibility() {
  $('greeting').textContent = greeting();
  $('emptyNote').textContent = engine.ready
    ? `${engine.model.name} is ready. Everything stays on this device.` : '';
  const hasMessages = chat.messages.length > 0 || $('messages').childElementCount > 0;
  $('onboard').hidden = engine.ready || hasMessages;
  $('empty').hidden = !engine.ready || hasMessages;
}

function scrollToEnd(force = false) {
  const scroller = $('scroll');
  const nearEnd = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140;
  if (force || nearEnd) scroller.scrollTop = scroller.scrollHeight;
}

function renderHeader() {
  $('chatTitle').textContent = chat.title;
  const bar = $('loadBar');
  bar.hidden = !modelUi.loadingId;
  bar.firstElementChild.style.width = `${Math.round(modelUi.fraction * 100)}%`;
  const chip = $('modelChip');
  if (modelUi.loadingId) {
    chip.textContent = modelUi.text || 'Loading model…';
  } else if (engine.ready) {
    const gpu = engine.mode?.gpu ? 'WebGPU' : 'CPU';
    chip.textContent = `${engine.model.name} · ${gpu}${navigator.onLine ? '' : ' · Offline'}`;
  } else {
    chip.textContent = 'No model loaded · tap to choose';
  }
}

function renderComposer() {
  const sendButton = $('send');
  sendButton.classList.toggle('busy', busy);
  sendButton.setAttribute('aria-label', busy ? 'Stop' : 'Send');
  sendButton.disabled = !busy && (!engine.ready || !$('input').value.trim());
  $('input').placeholder = engine.ready ? 'Message'
    : modelUi.loadingId ? 'Getting the model ready…' : 'Choose a model to start';
  if (!busy && !engine.ready && chat.messages.length) {
    setStatus(modelUi.loadingId ? 'Loading model…' : 'Load a model to continue this chat.');
  }
}

function chatGroup(time) {
  const day = 86400000;
  const today = new Date().setHours(0, 0, 0, 0);
  if (time >= today) return 'Today';
  if (time >= today - day) return 'Yesterday';
  if (time >= today - 7 * day) return 'Previous 7 days';
  return 'Older';
}

function renderChatList() {
  const list = $('chatList');
  if (!chats.length) {
    list.replaceChildren(h('div', { class: 'chat-empty' }, 'Your chats will appear here.'));
    return;
  }
  const nodes = [];
  let group = '';
  for (const c of chats) {
    const next = chatGroup(c.updatedAt);
    if (next !== group) {
      group = next;
      nodes.push(h('div', { class: 'chat-group' }, group));
    }
    nodes.push(h('div', { class: `chat-item${c.id === chat.id ? ' current' : ''}` },
      h('button', { class: 'open', type: 'button', onclick: () => { openChat(c); closeDrawer(); } }, c.title),
      h('button', {
        class: 'del', type: 'button', 'aria-label': `Delete chat: ${c.title}`, html: ICONS.trash,
        onclick: async () => { if (await confirmDialog(`Delete "${c.title}"?`)) deleteChat(c.id); },
      })
    ));
  }
  list.replaceChildren(...nodes);
}

function renderModels() {
  for (const container of [$('onboardModels'), $('settingsModels')]) {
    container.replaceChildren(...MODELS.map((m) => {
      const active = engine.model?.id === m.id;
      const loading = modelUi.loadingId === m.id;
      const onDevice = cached.has(m.url);
      const row = h('div', { class: `model${active ? ' active' : ''}` });

      const partial = !onDevice && partials.get(m.id);
      const partialPct = partial && partial.total
        ? Math.min(99, Math.round((partial.loaded / partial.total) * 100)) : 0;

      const actions = h('div', { class: 'model-actions' });
      if (loading && modelUi.phase === 'download') {
        actions.append(h('button', {
          class: 'pill quiet', type: 'button', onclick: () => engine.pauseDownload(),
        }, 'Pause'));
      }
      if (!loading && !active) {
        actions.append(h('button', {
          class: 'pill', type: 'button', disabled: !!modelUi.loadingId,
          onclick: () => loadModel(m),
        }, onDevice ? 'Use' : partial ? 'Resume' : 'Download'));
      }
      if (!loading && (onDevice || partial)) {
        actions.append(h('button', {
          class: 'pill quiet', type: 'button', 'aria-label': `Delete ${m.name}`,
          html: ICONS.trash,
          onclick: async () => {
            const what = onDevice ? m.name : `the unfinished download of ${m.name}`;
            if (!(await confirmDialog(`Delete ${what} from this device?`))) return;
            await engine.deleteModel(m).catch((e) => toast(friendlyError(e)));
            await refreshCached();
            renderAll();
          },
        }));
      }

      const state = active ? 'In use' : onDevice ? 'On device'
        : partial && !loading ? `Paused at ${partialPct}%` : '';
      row.append(h('div', { class: 'model-top' },
        h('div', { class: 'model-text' },
          h('div', { class: 'model-name' }, m.name),
          h('div', { class: 'model-meta' }, (m.sizeMB ? `${formatMB(m.sizeMB)} · ` : '') + m.note),
          state && h('div', { class: 'model-state' }, state)
        ),
        actions
      ));

      if (loading) {
        row.classList.add('loading');
        row.append(
          h('div', { class: 'bar' }, h('div', { style: `width:${Math.round(modelUi.fraction * 100)}%` })),
          h('p', { class: 'progress-text' }, modelUi.text)
        );
      } else if (partial) {
        row.append(h('div', { class: 'bar' }, h('div', { style: `width:${partialPct}%` })));
      }
      if (modelUi.errorId === m.id) {
        row.append(
          h('p', { class: 'error' }, modelUi.error),
          h('button', { class: 'pill quiet', type: 'button', onclick: copyDiagnostics }, 'Copy diagnostics')
        );
      }
      return row;
    }));
  }
}

function renderAll() {
  renderHeader();
  renderModels();
  renderMessages();
  renderChatList();
  renderContext();
  renderComposer();
  if (!busy && (engine.ready || !chat.messages.length)) setStatus('');
  scrollToEnd(true);
}

// ====================================================================
// Models
// ====================================================================

async function refreshCached() {
  cached = await engine.cachedUrls();
  partials = new Map();
  for (const m of MODELS) {
    if (cached.has(m.url)) continue;
    const partial = await engine.partial(m);
    if (partial) partials.set(m.id, partial);
  }
}

/** Updates progress in place. Rebuilding the rows would swallow button taps. */
function paintProgress() {
  renderHeader();
  for (const row of document.querySelectorAll('.model.loading')) {
    row.querySelector('.bar > div').style.width = `${Math.round(modelUi.fraction * 100)}%`;
    row.querySelector('.progress-text').textContent = modelUi.text;
  }
}

// Keeps the screen on during a download or load, where the browser allows
// it. A locked phone suspends the app and stalls the download.
async function holdWakeLock() {
  try { return await navigator.wakeLock?.request('screen'); } catch (e) { return null; }
}

async function loadModel(model) {
  if (modelUi.loadingId) return;
  if (busy) abortController?.abort();
  const onDevice = cached.has(model.url);
  Object.assign(modelUi, {
    loadingId: model.id, phase: onDevice ? 'load' : 'download', fraction: 0, errorId: null, error: '',
    text: onDevice ? 'Loading…' : 'Starting download…',
  });
  renderAll();

  if (!onDevice) {
    settings.pendingModelId = model.id;
    saveSettings();
  }
  const wakeLock = await holdWakeLock();
  let lastPaint = 0;
  try {
    const mode = await engine.load(model, settings, (p) => {
      const phaseChanged = modelUi.phase !== p.phase;
      modelUi.phase = p.phase;
      modelUi.fraction = p.fraction;
      if (p.phase === 'download') {
        const amount = `${formatMB(p.loaded / 1e6)} of ${formatMB(p.total / 1e6)}`;
        modelUi.text = p.state === 'waiting' ? `No connection. Waiting to resume at ${amount}…`
          : p.state === 'retrying' ? `Connection dropped. Retrying from ${amount}…`
          : `Downloading ${amount}`;
      } else {
        const how = p.attempt > 1
          ? ` (retrying ${p.mode.gpu ? 'with' : 'without'} GPU${p.mode.single ? ', one thread' : ''})`
          : '';
        modelUi.text = `Loading into memory… ${Math.round(p.fraction * 100)}%${how}`;
      }
      if (phaseChanged) {
        renderHeader();
        renderModels();
      } else if (performance.now() - lastPaint > 200 || p.state !== 'downloading') {
        lastPaint = performance.now();
        paintProgress();
      }
    });
    settings.modelId = model.id;
    settings.loadMode = mode;
    settings.pendingModelId = null;
    saveSettings();
  } catch (e) {
    settings.pendingModelId = null;
    saveSettings();
    if (e?.name !== 'AbortError') {
      console.error(e);
      modelUi.errorId = model.id;
      modelUi.error = explainLoadError(e, onDevice);
    }
  }
  wakeLock?.release().catch(() => {});
  modelUi.phase = '';
  modelUi.loadingId = null;
  reloadNeeded = false;
  chat.ctx = null;
  await refreshCached();
  renderAll();
  if (engine.ready && !$('settings').open) $('input').focus({ preventScroll: true });
}

async function copyDiagnostics() {
  const text = diagnostics();
  try {
    await navigator.clipboard.writeText(text);
    toast('Diagnostics copied. Paste them into a message.');
  } catch (e) {
    // Clipboard can be blocked. Fall back to the share sheet.
    try { await navigator.share({ text }); } catch (e2) { toast('Could not copy diagnostics.'); }
  }
}

function explainLoadError(e, onDevice) {
  const text = String(e?.message || e);
  if (!navigator.onLine && !onDevice) {
    return 'You are offline and this model is not on the device yet. Connect once to download it.';
  }
  if (/quota|storage|space/i.test(text)) {
    return 'Not enough storage for this model. Free some space or pick the smaller one.';
  }
  if (/memory|alloc|OOM/i.test(text)) {
    return 'This model is too big for the memory this browser allows. Try the smaller one, or a smaller context size.';
  }
  return `Could not load the model: ${text}`;
}

// ====================================================================
// Settings
// ====================================================================

function applyAppearance() {
  const root = document.documentElement;
  if (settings.theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', settings.theme);
  root.setAttribute('data-text', settings.textSize);
  const dark = settings.theme === 'dark' ||
    (settings.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]').content = dark ? '#212121' : '#ffffff';
}

async function openSettings() {
  closeDrawer();
  $('setInstructions').value = settings.instructions;
  $('setMemoryOn').checked = settings.memoryOn;
  $('setAutoMemory').checked = settings.autoMemory;
  $('setTemperature').value = settings.temperature;
  $('outTemperature').textContent = settings.temperature.toFixed(1);
  $('setMaxTokens').value = settings.maxTokens;
  $('setThinking').checked = settings.thinking;
  $('setCtx').value = settings.nCtx;
  $('setAutoSummary').checked = settings.autoSummary;
  $('setGpu').checked = settings.gpu;
  $('setTheme').value = settings.theme;
  $('setTextSize').value = settings.textSize;
  $('about').textContent = `Engine: llama.cpp ${Engine.version()}, running through wllama.`;
  renderMemories();
  renderModels();
  $('settings').showModal();
  $('settings').querySelector('.sheet-body').scrollTop = 0;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    $('storageInfo').textContent =
      `Using ${formatMB(usage / 1e6)} of ${formatMB(quota / 1e6)} available on this device.`;
  } catch (e) { $('storageInfo').textContent = ''; }
}

function bindSetting(id, key, { type = 'value', parse = (v) => v, reload = false, after } = {}) {
  $(id).addEventListener(type === 'checked' ? 'change' : 'input', () => {
    settings[key] = type === 'checked' ? $(id).checked : parse($(id).value);
    if (reload) reloadNeeded = true;
    saveSettings();
    after?.();
  });
}

function setupSettings() {
  bindSetting('setInstructions', 'instructions', { after: () => { chat.ctx = null; } });
  bindSetting('setMemoryOn', 'memoryOn', { type: 'checked' });
  bindSetting('setAutoMemory', 'autoMemory', { type: 'checked' });
  bindSetting('setTemperature', 'temperature', {
    parse: Number,
    after: () => { $('outTemperature').textContent = settings.temperature.toFixed(1); },
  });
  bindSetting('setMaxTokens', 'maxTokens', { parse: Number });
  bindSetting('setThinking', 'thinking', { type: 'checked' });
  bindSetting('setCtx', 'nCtx', { parse: Number, reload: true, after: () => { settings.badModes = []; } });
  bindSetting('setAutoSummary', 'autoSummary', { type: 'checked' });
  bindSetting('setGpu', 'gpu', {
    type: 'checked', reload: true,
    after: () => { settings.loadMode = null; settings.badModes = []; },
  });
  bindSetting('setTheme', 'theme', { after: applyAppearance });
  bindSetting('setTextSize', 'textSize', { after: applyAppearance });

  $('settingsDone').addEventListener('click', () => $('settings').close());
  $('settings').addEventListener('close', () => {
    if (reloadNeeded && engine.ready && !modelUi.loadingId) loadModel(engine.model);
    reloadNeeded = false;
    renderAll();
  });

  $('memoryForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $('memoryInput');
    if (addMemory(input.value, { quiet: true })) input.value = '';
    else if (input.value.trim()) toast('Already in memory.');
  });

  $('exportBtn').addEventListener('click', () => {
    const data = { exportedAt: new Date().toISOString(), memories, chats };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    h('a', { href: url, download: `pocket-llm-${new Date().toISOString().slice(0, 10)}.json` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
  $('diagnosticsBtn').addEventListener('click', copyDiagnostics);
  $('crashCopy').addEventListener('click', copyDiagnostics);
  $('deleteChatsBtn').addEventListener('click', async () => {
    if (!(await confirmDialog('Delete every chat? This cannot be undone.', 'Delete all'))) return;
    chats = [];
    await store.clearChats().catch(console.warn);
    openChat(blankChat());
  });
  $('deleteMemoriesBtn').addEventListener('click', async () => {
    if (!(await confirmDialog('Delete every memory? This cannot be undone.', 'Delete all'))) return;
    memories = [];
    saveMemories();
    renderMemories();
  });
  $('deleteModelsBtn').addEventListener('click', async () => {
    if (!(await confirmDialog('Delete all downloaded models? You will need to download one again to chat.', 'Delete all'))) return;
    await engine.deleteAllModels().catch((e) => toast(friendlyError(e)));
    await refreshCached();
    renderAll();
  });
}

// ====================================================================
// Drawer, composer and other events
// ====================================================================

const wide = matchMedia('(min-width: 900px)');

function openDrawer() {
  if (wide.matches) return;
  renderChatList();
  $('drawer').classList.add('open');
  $('drawer').inert = false;
  $('scrim').hidden = false;
}
function closeDrawer() {
  $('drawer').classList.remove('open');
  $('drawer').inert = !wide.matches;
  $('scrim').hidden = true;
}

function autoGrow() {
  const input = $('input');
  input.style.height = 'auto';
  input.style.height = `${input.scrollHeight}px`;
}

function setupEvents() {
  $('menuBtn').addEventListener('click', openDrawer);
  $('drawerClose').addEventListener('click', closeDrawer);
  $('scrim').addEventListener('click', closeDrawer);
  $('settingsBtn').addEventListener('click', openSettings);
  $('modelChip').addEventListener('click', openSettings);
  $('drawerNew').addEventListener('click', () => {
    closeDrawer();
    openChat(blankChat());
    if (engine.ready) $('input').focus();
  });
  wide.addEventListener('change', closeDrawer);
  closeDrawer();
  addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDrawer();
  });

  // A button to get back to the newest message after scrolling up.
  const scroller = $('scroll');
  const updateJump = () => {
    const away = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 240;
    $('jump').hidden = !away;
  };
  scroller.addEventListener('scroll', updateJump, { passive: true });
  $('jump').addEventListener('click', () => {
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
  });

  $('newBtn').addEventListener('click', () => {
    openChat(blankChat());
    if (engine.ready) $('input').focus();
  });

  $('form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy) { abortController?.abort(); return; }
    const text = $('input').value.trim();
    if (!text || !engine.ready) return;
    $('input').value = '';
    autoGrow();
    renderComposer();
    send(text);
  });
  $('input').addEventListener('input', () => { autoGrow(); renderComposer(); });
  $('input').addEventListener('keydown', (event) => {
    const touch = matchMedia('(pointer: coarse)').matches;
    if (event.key === 'Enter' && !event.shiftKey && !touch && !event.isComposing) {
      event.preventDefault();
      $('form').requestSubmit();
    }
  });

  $('suggestions').replaceChildren(...SUGGESTIONS.map((text) =>
    h('button', { type: 'button', onclick: () => { if (engine.ready && !busy) send(text); } }, text)
  ));

  $('ctxBtn').addEventListener('click', () => {
    const used = usedTokens();
    $('ctxText').textContent =
      `About ${used.toLocaleString()} of ${contextSize().toLocaleString()} tokens used` +
      (chat.cut ? `, with ${chat.cut} earlier messages ${chat.summary ? 'summarised' : 'dropped'}.` : '.');
    $('ctxCompact').hidden = !engine.ready || busy || chat.messages.length - chat.cut <= 2;
    $('ctxCompact').textContent = settings.autoSummary ? 'Summarise now' : 'Drop old messages';
    $('ctxDialog').showModal();
  });
  $('ctxClose').addEventListener('click', () => $('ctxDialog').close());
  $('ctxCompact').addEventListener('click', async () => {
    $('ctxDialog').close();
    busy = true;
    abortController = new AbortController();
    renderComposer();
    try { await compact({ signal: abortController.signal, keep: 2 }); }
    catch (e) { if (e?.name !== 'AbortError') toast(friendlyError(e)); }
    busy = false;
    abortController = null;
    setStatus('');
    renderComposer();
  });

  for (const dialog of [$('settings'), $('ctxDialog'), $('confirmDialog')]) {
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  }

  addEventListener('online', renderHeader);
  addEventListener('offline', renderHeader);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyAppearance);

  // iOS keeps the page full height when the keyboard opens, hiding the
  // composer. Size the app to the visible area instead.
  if (window.visualViewport) {
    const fit = () => {
      $('app').style.height = `${visualViewport.height}px`;
      scrollTo(0, 0);
      scrollToEnd();
    };
    visualViewport.addEventListener('resize', fit);
  }
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    // When an updated version takes over, reload so the page matches it.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      const idle = !busy && !modelUi.loadingId && !$('input').value.trim() && !$('settings').open;
      if (idle) location.reload();
      else toast('An update is ready.', 'Reload', () => location.reload());
    });
    await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    // Hosts that cannot send the isolation headers get them from the service
    // worker, which only applies to pages it served. Reload once for that.
    if (!self.crossOriginIsolated && !sessionStorage.getItem('coi-reloaded')) {
      sessionStorage.setItem('coi-reloaded', '1');
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) => {
          navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
          setTimeout(resolve, 3000);
        });
      }
      if (!engine.ready && !modelUi.loadingId) location.reload();
    }
  } catch (e) {
    console.warn('Service worker registration failed', e);
  }
}

// ====================================================================
// Start
// ====================================================================

async function start() {
  try {
    settings = { ...DEFAULTS, ...((await store.getValue('settings')) || {}) };
    memories = (await store.getValue('memories')) || [];
    chats = await store.listChats();
  } catch (e) {
    console.warn('Storage unavailable, nothing will be saved', e);
  }
  if (!MODELS.some((m) => m.id === settings.modelId)) settings.modelId = MODELS[0].id;
  // A phone that has never loaded a model successfully starts with the small context.
  if (isIOS && !settings.loadMode && settings.nCtx > 2048) settings.nCtx = 2048;
  if (MODELS[0].id === 'custom') settings.modelId = 'custom';

  chat = blankChat();
  applyAppearance();
  setupEvents();
  setupSettings();

  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  $('installHint').hidden = !(isIOS && !standalone);

  if (previousCrash) {
    // The last load took the whole page down, most likely by running out of
    // memory. Avoid that mode from now on, and trim the context if even the
    // lightest mode failed.
    const key = modeKey(previousCrash);
    if (!settings.badModes.includes(key)) settings.badModes.push(key);
    if (settings.loadMode && modeKey(settings.loadMode) === key) settings.loadMode = null;
    const lightest = !previousCrash.gpu && previousCrash.single;
    if (lightest && settings.nCtx > 2048) settings.nCtx = 2048;
    saveSettings();
    $('crashText').textContent = lightest
      ? 'The browser ran out of memory loading the model, even in its lightest mode. ' +
        'Close other tabs and apps and try again, or this device may not have enough memory for it.'
      : 'The browser ran out of memory loading the model last time. It will use a lighter mode now. ' +
        'Closing other tabs and apps also helps.';
    $('crashNote').hidden = false;
  }

  await refreshCached();
  renderAll();

  registerServiceWorker();

  // Open ready to chat when the chosen model is already on the device.
  // Otherwise pick up a download that was cut off last time. Only auto-load
  // a model that has loaded successfully on this device before, and never
  // straight after a crash: a load that kills the page would otherwise make
  // the app impossible to open.
  const preferred = MODELS.find((m) => m.id === settings.modelId);
  const pending = MODELS.find((m) => m.id === settings.pendingModelId);
  if (previousCrash) return;
  if (pending && !cached.has(pending.url)) loadModel(pending);
  else if (preferred && cached.has(preferred.url) && settings.loadMode) loadModel(preferred);
}

start();
