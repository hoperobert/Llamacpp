// Slash commands: what can be typed after a "/" in the message box.
//
// There are two kinds. Most act on the app (start a chat, change a setting).
// The rest are ready-made requests to the model (/plan, /summarise). Those are
// kept in the chat as typed and written out in full only for the model.
//
// Nothing here touches the phone, so the tests use it as it is.

export type Command = {
  name: string;
  /** Other names that do the same. */
  aliases?: string[];
  /** What it does, in a few words. */
  hint: string;
  /** What can be typed after it, shown as a prompt. Empty when it takes nothing. */
  takes?: string;
  /** For a request to the model: how it is written out, with something after the command and without. */
  prompt?: { with: (arg: string) => string; bare?: string };
};

const after = (instruction: string) => (arg: string) => `${instruction}\n\n${arg}`;

const PLAN =
  'Number the steps and keep each one short. List anything that has to be decided first. ' +
  'Do not carry the plan out yet.';

export const COMMANDS: Command[] = [
  // ---------- requests to the model ----------
  {
    name: 'plan', hint: 'Plan it step by step', takes: 'what to plan',
    prompt: {
      with: after(`Write a step-by-step plan for the following. ${PLAN}`),
      bare: `Write a step-by-step plan for what we have been discussing. ${PLAN}`,
    },
  },
  { name: 'goal', hint: 'Set a goal for this chat', takes: 'the goal, or "clear"' },
  {
    name: 'summarise', aliases: ['summarize', 'tldr'], hint: 'Sum it up', takes: 'text, or nothing for this chat',
    prompt: {
      with: after('Summarise the following in a few short points.'),
      bare: 'Summarise this conversation so far in a few short points.',
    },
  },
  {
    name: 'explain', hint: 'Explain it simply', takes: 'what to explain',
    prompt: {
      with: after('Explain the following simply, as you would to someone new to it, with one example.'),
      bare: 'Explain your last reply more simply, as you would to someone new to it, with one example.',
    },
  },
  {
    name: 'rewrite', hint: 'Make it read better', takes: 'text, or nothing for the last reply',
    prompt: {
      with: after('Rewrite the following so that it is clearer and reads better. Keep its meaning. Reply with the rewritten text only.'),
      bare: 'Rewrite your last reply so that it is clearer and reads better.',
    },
  },
  {
    name: 'shorter', hint: 'Say it in less', takes: 'text, or nothing for the last reply',
    prompt: {
      with: after('Shorten the following to about half its length, keeping what matters most. Reply with the shortened text only.'),
      bare: 'Rewrite your last reply at about half the length, keeping what matters most.',
    },
  },
  {
    name: 'longer', hint: 'Go into more detail', takes: 'text, or nothing for the last reply',
    prompt: {
      with: after('Expand the following with more detail and an example.'),
      bare: 'Expand your last reply with more detail and an example.',
    },
  },
  {
    name: 'translate', hint: 'Translate', takes: 'a language, then text',
    prompt: {
      with: (arg) => {
        const [language, ...rest] = arg.split(/\s+/);
        const text = rest.join(' ');
        return text
          ? `Translate the following into ${language}. Reply with the translation only.\n\n${text}`
          : `Translate your last reply into ${language}. Reply with the translation only.`;
      },
    },
  },
  {
    name: 'brainstorm', hint: 'Come up with ideas', takes: 'a topic',
    prompt: { with: after('Brainstorm ten varied ideas for the following. One line each, the most promising first.') },
  },
  {
    name: 'review', hint: 'Find what is wrong', takes: 'text, or nothing for the last reply',
    prompt: {
      with: after('Review the following. Say what works, what does not, and how to improve it, the most important first.'),
      bare: 'Review your last reply critically. Point out anything wrong, missing or unclear, then give a corrected version.',
    },
  },
  {
    name: 'fix', aliases: ['proofread'], hint: 'Correct spelling and grammar', takes: 'text',
    prompt: { with: after('Correct the spelling, grammar and punctuation of the following. Change nothing else. Reply with the corrected text only.') },
  },

  // ---------- on this iPhone ----------
  { name: 'remind', aliases: ['reminder'], hint: 'Set a reminder', takes: 'what, and when' },
  { name: 'timer', hint: 'Start a timer', takes: 'how long' },
  { name: 'event', aliases: ['calendar'], hint: 'Add to your calendar', takes: 'what, and when' },
  { name: 'text', aliases: ['message', 'sms'], hint: 'Start a message', takes: 'a name, then the message' },
  { name: 'email', hint: 'Start an email', takes: 'a name, then what to say' },
  { name: 'call', hint: 'Call someone', takes: 'a name' },
  { name: 'directions', aliases: ['maps', 'navigate'], hint: 'Directions in Maps', takes: 'a place' },
  { name: 'run', hint: 'Run the code in the last reply' },
  { name: 'voice', aliases: ['speak', 'talk'], hint: 'Speak, and hear the reply' },
  { name: 'file', aliases: ['attach'], hint: 'Attach a file' },
  { name: 'photo', hint: 'Attach a photo' },

  // ---------- this chat ----------
  { name: 'new', aliases: ['clear'], hint: 'Start a new chat' },
  { name: 'incognito', hint: 'Start a chat that is not saved' },
  { name: 'retry', aliases: ['regenerate'], hint: 'Ask for the last reply again' },
  { name: 'stop', hint: 'Stop the reply' },
  { name: 'compact', hint: 'Summarise earlier messages to make room' },
  { name: 'context', hint: 'How full this chat is' },
  { name: 'rename', hint: 'Name this chat', takes: 'a title' },
  { name: 'pin', hint: 'Pin or unpin this chat' },
  { name: 'share', aliases: ['export'], hint: 'Share this chat' },
  { name: 'delete', hint: 'Delete this chat' },

  // ---------- how replies are written ----------
  { name: 'model', hint: 'Change model', takes: 'a name, or nothing to choose' },
  { name: 'think', hint: 'Think first, on or off', takes: 'on or off' },
  { name: 'lookup', hint: 'Look things up, on or off', takes: 'on or off' },
  { name: 'style', hint: 'Normal, concise, explain or formal', takes: 'normal, concise, explain or formal' },
  { name: 'length', hint: 'Short, medium, long or max', takes: 'short, medium, long or max' },

  // ---------- memory and places ----------
  { name: 'remember', hint: 'Save a fact about you', takes: 'what to remember' },
  { name: 'memory', aliases: ['memories'], hint: 'What is remembered' },
  { name: 'chats', aliases: ['resume'], hint: 'Your chats' },
  { name: 'projects', hint: 'Your projects' },
  { name: 'library', hint: 'The offline library' },
  { name: 'settings', aliases: ['config'], hint: 'Settings' },
  { name: 'help', hint: 'Show every command' },
];

const named = (name: string) => {
  const wanted = name.toLowerCase();
  return COMMANDS.find((c) => c.name === wanted || c.aliases?.includes(wanted));
};

/** The command a message begins with, and what follows it. Null for an ordinary message. */
export function parseCommand(text: string): { command: Command; arg: string } | null {
  const match = text.trim().match(/^\/([a-z]+)(?:\s+([\s\S]*))?$/i);
  const command = match && named(match[1]);
  return command ? { command, arg: (match[2] ?? '').trim() } : null;
}

/** The commands to offer while one is being typed. Empty once it is finished, or for an ordinary message. */
export function suggest(draft: string): Command[] {
  const match = draft.match(/^\/([a-z]*)$/i);
  if (!match) return [];
  const typed = match[1].toLowerCase();
  const byName = COMMANDS.filter((c) => c.name.startsWith(typed));
  const byAlias = COMMANDS.filter((c) => !c.name.startsWith(typed) && c.aliases?.some((a) => a.startsWith(typed)));
  return [...byName, ...byAlias];
}

/** A message as the model should read it: a request command is written out in full. */
export function expandCommand(content: string): string {
  const parsed = parseCommand(content);
  const prompt = parsed?.command.prompt;
  if (!prompt) return content;
  if (parsed.arg) return prompt.with(parsed.arg);
  return prompt.bare ?? content;
}

/** What a message is about, without the command in front: for naming a chat and looking things up. */
export function subjectOf(content: string): string {
  const parsed = parseCommand(content);
  return parsed?.command.prompt && parsed.arg ? parsed.arg : content;
}

/**
 * A command for doing something on the phone, as the plain request it stands
 * for: "/timer 10 minutes" is "Set a timer for 10 minutes". Null for any other command.
 */
export function asRequest(name: string, arg: string): string | null {
  const said = arg.trim();
  switch (name) {
    case 'remind': return `Remind me ${/^(?:to|about|in|at|on|that|tomorrow|today|tonight)\b/i.test(said) ? '' : 'to '}${said}`;
    case 'timer': return `Set a timer for ${said.replace(/^for\s+/i, '')}`;
    case 'event': return `Add ${said} to my calendar`;
    case 'text': return `Text ${said}`;
    case 'email': return `Email ${said}`;
    case 'call': return `Call ${said}`;
    case 'directions': return `Directions to ${said.replace(/^to\s+/i, '')}`;
    default: return null;
  }
}

/** The last block of code in a reply that names its language, for /run. */
export function lastCode(reply: string): { lang: string; code: string } | null {
  const blocks = [...reply.matchAll(/```[ \t]*([\w+#.-]*)[ \t]*\n([\s\S]*?)\n[ \t]*```/g)];
  const block = blocks.at(-1);
  return block ? { lang: block[1], code: block[2] } : null;
}

/** Reads "on", "off" or nothing (which flips it). Null when it is none of those. */
export function onOrOff(arg: string, current: boolean): boolean | null {
  const word = arg.toLowerCase();
  if (!word) return !current;
  if (['on', 'yes', 'true', '1'].includes(word)) return true;
  if (['off', 'no', 'false', '0'].includes(word)) return false;
  return null;
}
