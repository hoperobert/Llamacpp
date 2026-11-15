// Tidying up what a model writes when it is asked for something short.

// How models mark their thinking. Most wrap it in <think> tags. Gemma 4 puts
// it in a "channel": <|channel>thought ... <channel|>. The engine is meant to
// take these out and hand the thinking over separately, but does not always
// (it missed Gemma 4's), and then the markers and the thinking turn up in the
// reply itself.
const OPEN = String.raw`<think(?:ing)?>|<\|channel>(?:thought|thinking|analysis|reasoning)\b[ \t]*\n?`;
const CLOSE = String.raw`<\/think(?:ing)?>|<channel\|>`;
const BLOCK = new RegExp(`(?:${OPEN})([\\s\\S]*?)(?:${CLOSE})`, 'gi');
const UNCLOSED = new RegExp(`(?:${OPEN})([\\s\\S]*)$`, 'i');
const UNOPENED = new RegExp(`^([\\s\\S]*?)(?:${CLOSE})`, 'i');
// Markers that mean nothing to a reader if any are left over.
const STRAY = /<\/?think(?:ing)?>|<\|channel>\w*[ \t]*\n?|<channel\|>|<\|?(?:turn|im_start|im_end|end_of_turn|start_of_turn|eot_id)\|?>/gi;

/**
 * Separates what a model wrote into its answer and its thinking, whichever way
 * the thinking is marked. Works on a reply that is still being written: a
 * block that has been opened and not yet closed is all thinking so far.
 */
export function splitThinking(raw: string): { content: string; reasoning: string } {
  const thoughts: string[] = [];
  let rest = raw.replace(BLOCK, (_all, thought: string) => {
    thoughts.push(thought.trim());
    return '\n';
  });
  // Some models begin already thinking, so only the closing marker appears.
  rest = rest.replace(UNOPENED, (_all, thought: string) => {
    if (thought.trim()) thoughts.unshift(thought.trim());
    return '';
  });
  rest = rest.replace(UNCLOSED, (_all, thought: string) => {
    thoughts.push(thought.trim());
    return '';
  });
  return {
    content: rest.replace(STRAY, '').replace(/\n{3,}/g, '\n\n').trim(),
    reasoning: thoughts.filter(Boolean).join('\n\n').replace(STRAY, '').trim(),
  };
}

/** Removes a model's thinking, and any stray thinking markers, from its output. */
export const withoutThinking = (raw: string): string => splitThinking(raw).content;

/**
 * Turns a model's reply into a chat title, or '' if nothing usable is left.
 * Small models add labels, quotes, Markdown and thinking tags around the title.
 */
export function cleanTitle(raw: string): string {
  const line = withoutThinking(raw).split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const title = line
    .replace(/^(?:chat\s+)?title\s*[:\-–]\s*/i, '')
    .replace(/<[^>]*>/g, '')
    .replace(/^["'“‘*#\s]+|["'”’*.\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return title.length >= 3 && title.length <= 60 ? title : '';
}

/** True for a saved title that an earlier version let through with tags or a label in it. */
export const isBrokenTitle = (title: string) => /<\/?think|^(?:chat\s+)?title\s*[:\-–]/i.test(title);

/**
 * A reply that was stopped before it began leaves two of the user's messages
 * next to each other. Many models are only taught conversations that take
 * turns, and some refuse anything else, so neighbours from the same side are
 * joined into one.
 */
export function takingTurns<T extends { role: string; content: string; image?: string }>(messages: T[]): T[] {
  const out: T[] = [];
  for (const message of messages) {
    const before = out.at(-1);
    if (before && before.role === message.role) {
      out[out.length - 1] = {
        ...before,
        content: [before.content, message.content].filter(Boolean).join('\n\n'),
        image: message.image ?? before.image,
      };
    } else {
      out.push(message);
    }
  }
  return out;
}
