// Tidying up what a model writes when it is asked for something short.

/** Removes a model's thinking, and any stray thinking tags, from its output. */
export function withoutThinking(raw: string): string {
  return raw
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, ' ')
    // An opening tag that was never closed: everything after it is thinking.
    .replace(/<think(?:ing)?>[\s\S]*$/i, ' ')
    .replace(/<\/?think(?:ing)?>/gi, ' ')
    .trim();
}

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
