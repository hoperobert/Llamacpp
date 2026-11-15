// Prompt building, context handling and memories. No UI in here.

import { expandCommand, subjectOf } from './commands';
import * as engine from './engine';
import { EMERGENCY } from './mode';
import { newId, STYLES, type Chat, type Memory, type Project, type Settings } from './storage';
import { withReferences } from './retrieval';
import { cleanTitle, takingTurns, withoutThinking } from './text';

export const KEEP_RECENT = 4;        // messages left untouched when a chat is compacted
const MAX_MEMORIES = 40;
const MEMORY_PROMPT_CHARS = 1500;

export const estimateTokens = (text: string) => Math.ceil(text.length / 3) + 6;

export function systemPrompt(chat: Chat, settings: Settings, memories: Memory[], project?: Project): string {
  const parts = [
    "You are a helpful assistant running privately on the user's own device. " +
      `Keep answers clear and concise. Today is ${new Date().toDateString()}.`,
    // The Run button on a code block. Said so that a model asked for something to run picks a language that can be.
    'The user can run JavaScript, and open HTML pages, that you write in code blocks on this device.',
  ];
  const style = STYLES.find((s) => s.id === settings.style)?.prompt;
  if (settings.emergency) parts.push(EMERGENCY);
  else if (style) parts.push(style);
  if (settings.instructions.trim()) {
    parts.push(`Follow these instructions from the user:\n${settings.instructions.trim()}`);
  }
  if (project?.instructions.trim()) {
    parts.push(`This chat is part of the project "${project.name}". Follow its instructions:\n${project.instructions.trim()}`);
  }
  if (chat.goal) {
    parts.push(
      `The user has set a goal for this conversation: ${chat.goal}\n` +
        'Work towards it in every reply, and say plainly when it has been met.',
    );
  }
  if (settings.memoryOn && memories.length) {
    const lines: string[] = [];
    let used = 0;
    for (const m of [...memories].reverse()) {
      if (used + m.text.length > MEMORY_PROMPT_CHARS) break;
      used += m.text.length;
      lines.unshift(`- ${m.text}`);
    }
    parts.push(
      `Facts about the user, the person you are talking to. Use them when relevant:\n${lines.join('\n')}`,
    );
  }
  if (chat.summary) {
    parts.push(`Summary of the earlier part of this conversation:\n${chat.summary}`);
  }
  return parts.join('\n\n');
}

export function promptMessages(chat: Chat, settings: Settings, memories: Memory[], project?: Project) {
  const kept = chat.messages.slice(chat.cut);
  const turns = kept
    // Something the app offered to do, and the request it answered, are between the user and
    // the app. A small model that reads them starts writing offers of its own that do nothing.
    .filter((m, i) => !m.action && !kept[i + 1]?.action)
    .filter((m) => m.content || m.image)
    // What was looked up for a message is given to the model with it, every time,
    // so the conversation it has already read stays the same.
    // A request typed as a command ("/plan a trip") is written out in full here.
    .map(({ role, content, image, context }) => {
      // The model's own earlier thinking is never read back to it.
      const said = role === 'user' ? expandCommand(content) : withoutThinking(content);
      return { role, image, content: context ? withReferences(said, context) : said };
    });
  return [
    { role: 'system' as const, content: systemPrompt(chat, settings, memories, project), image: undefined },
    ...takingTurns(turns),
  ];
}


/** Tokens the chat occupies. Measured where possible, otherwise estimated. */
export function usedTokens(chat: Chat, settings: Settings, memories: Memory[], project?: Project): number {
  if (chat.ctx && chat.ctx.cut === chat.cut && chat.ctx.count <= chat.messages.length) {
    const added = chat.messages.slice(chat.ctx.count);
    return chat.ctx.used + added.reduce((n, m) => n + estimateTokens(m.content + (m.context ?? '')), 0);
  }
  return estimateTokens(systemPrompt(chat, settings, memories, project)) +
    chat.messages.slice(chat.cut).reduce((n, m) => n + estimateTokens(m.content + (m.context ?? '')), 0);
}

export const replyBudget = (settings: Settings) =>
  Math.min(settings.maxTokens, Math.floor(settings.nCtx / 2));

/**
 * Frees context by folding the oldest messages into a summary (or dropping
 * them when summaries are off). Returns the updated chat, or null if nothing
 * could be freed.
 */
export async function compact(chat: Chat, settings: Settings, keep = KEEP_RECENT): Promise<Chat | null> {
  const end = chat.messages.length - Math.min(keep, chat.messages.length - 1);
  const old = chat.messages.slice(chat.cut, end);
  if (!old.length) return null;

  let summary = chat.summary;
  if (settings.autoSummary && engine.isLoaded()) {
    const budgetChars = Math.floor(settings.nCtx * 1.2);
    let transcript = old
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 700)}`)
      .join('\n');
    if (transcript.length > budgetChars) transcript = transcript.slice(-budgetChars);
    try {
      const text = await engine.complete([
        {
          role: 'system',
          content: 'You compress conversations. Write one summary under 120 words. Keep names, ' +
            'facts, decisions and unanswered questions. Reply with the summary only.',
        },
        {
          role: 'user',
          content: (summary ? `Summary so far:\n${summary}\n\n` : '') + `New messages:\n${transcript}`,
        },
      ], { maxTokens: 220 });
      const clean = withoutThinking(text);
      if (clean) summary = clean;
    } catch {
      // Fall back to dropping the old messages.
    }
  }
  return { ...chat, summary, cut: end, ctx: null };
}

export async function ensureRoom(
  chat: Chat, settings: Settings, memories: Memory[], project?: Project,
): Promise<Chat> {
  const limit = settings.nCtx - replyBudget(settings) - 48;
  let current = chat;
  let keep = KEEP_RECENT;
  for (let i = 0; i < 4 && usedTokens(current, settings, memories, project) > limit; i++) {
    const next = await compact(current, settings, keep);
    if (!next) break;
    current = next;
    keep = Math.max(1, keep - 2);
  }
  return current;
}

// ---------- titles ----------

/** Asks the model for a short title for a chat. Returns '' if it has nothing usable. */
export async function suggestTitle(chat: Chat): Promise<string> {
  const user = subjectOf(chat.messages.find((m) => m.role === 'user')?.content ?? '');
  const reply = chat.messages.find((m) => m.role === 'assistant')?.content ?? '';
  if (!user) return '';
  try {
    const raw = await engine.complete([
      {
        role: 'system',
        content: 'You name conversations. Reply with a title of two to five words and nothing else. ' +
          'No quotes, no full stop.',
      },
      { role: 'user', content: `User: ${user.slice(0, 400)}\n\nAssistant: ${reply.slice(0, 400)}\n\nTitle:` },
    ], { maxTokens: 16 });
    return cleanTitle(raw);
  } catch {
    return '';
  }
}

// ---------- memories ----------

// Only messages that look like they contain a personal fact are checked,
// because each check costs an extra model run.
const MEMORY_TRIGGER = /\b(my name is|call me|i am|i'm|i live|i work|i study|i like|i love|i hate|i prefer|i don't|i can't|i have|i own|i speak|my [\w' -]{2,30} (is|are)|remember that)\b/i;

const FACT_FILLER = new Set(['user', 'users', 'the', 'and', 'has', 'have', 'had', 'with', 'for',
  'that', 'this', 'are', 'was', 'not', 'from', 'named', 'called', 'name', 'lives', 'live',
  'works', 'work', 'likes', 'like', 'their', 'they', 'who']);
const words = (text: string) => text.toLowerCase().match(/[a-z0-9À-￿]{3,}/g) ?? [];

/** Small models sometimes invent facts. Keep one only if the message backs it up. */
function isUsefulFact(fact: unknown, message: string): fact is string {
  if (typeof fact !== 'string' || !/^user\b/i.test(fact.trim())) return false;
  if (/\b(requests?|asks?|asked|wants? (a|an|to know)|not specified|unknown|has no)\b/i.test(fact)) return false;
  const said = new Set(words(message));
  const key = words(fact).filter((w) => !FACT_FILLER.has(w));
  if (!key.length) return false;
  const grounded = key.filter((w) => said.has(w) || said.has(w.replace(/s$/, ''))).length;
  return grounded >= Math.ceil(key.length / 2);
}

/** Adds a memory unless it duplicates one. Returns the new list, or null if unchanged. */
export function addMemory(memories: Memory[], text: string): Memory[] | null {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, 160);
  if (clean.length < 3) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9À-￿ ]/g, '');
  const key = norm(clean);
  const duplicate = memories.some((m) => {
    const other = norm(m.text);
    return other === key || other.includes(key) || key.includes(other);
  });
  if (duplicate) return null;
  return [...memories, { id: newId(), text: clean }].slice(-MAX_MEMORIES);
}

/** Asks the model for lasting facts in a message. Returns the facts worth keeping. */
export async function extractFacts(userText: string): Promise<string[]> {
  if (userText.length > 600 || !MEMORY_TRIGGER.test(userText)) return [];
  try {
    const raw = await engine.complete([
      {
        role: 'system',
        content: 'You extract lasting personal facts about the user from one message: name, ' +
          'location, job, family, pets, tastes, needs. Write each as a short sentence starting ' +
          'with "User". Ignore questions, requests and things that are only true today. ' +
          'If there is nothing lasting, return an empty list.',
      },
      { role: 'user', content: `Message: """${userText}"""\n\nList the lasting facts about the user.` },
    ], {
      maxTokens: 120,
      schema: {
        type: 'object',
        properties: { facts: { type: 'array', items: { type: 'string' }, maxItems: 3 } },
        required: ['facts'],
      },
    });
    const facts: unknown[] = JSON.parse(raw).facts ?? [];
    return facts.filter((f): f is string => isUsefulFact(f, userText));
  } catch {
    return [];
  }
}
