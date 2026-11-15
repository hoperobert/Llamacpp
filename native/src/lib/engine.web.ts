// A stand-in engine for previewing the interface in a browser (`npx expo
// start --web`). It streams a canned reply so every part of a chat can be
// seen without a model. The real engine is in engine.ts.

export const engineVersion = 'preview';

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string; image?: string };
export type Timings = { used: number; speed: number; thought: number };

let loaded = false;
let stopping = false;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const SAMPLE = `Here is a short answer with a bit of everything.

## Why it works
Vaccines show your immune system a **harmless piece** of a germ, so it can *practise* before the real thing arrives.

1. The vaccine introduces an antigen.
2. Your body makes antibodies.
   - Some cells remember the antigen.
3. Next time, the response is fast.

| Type | Example | Doses |
| --- | --- | --- |
| mRNA | Covid-19 | 2 |
| Live | MMR | 2 |

\`\`\`python
def immune(memory, germ):
    return "fast" if germ in memory else "slow"
\`\`\`

> This is a preview reply, not a real model.

Read more at https://example.com or use \`inline code\`.`;

export async function loadModel(
  _uri: string, _nCtx: number, onProgress: (fraction: number) => void, projectorUri?: string,
) {
  loaded = false;
  for (let i = 1; i <= 10; i++) {
    await wait(120);
    onProgress(i / 10);
  }
  loaded = true;
  return { gpu: false, vision: !!projectorUri };
}

export const modelDetails = async (_uri: string): Promise<Record<string, unknown> | null> => null;
export async function unloadModel() { loaded = false; }
export const isLoaded = () => loaded;
export function stop() { stopping = true; }

export class Interrupted extends Error {
  constructor() {
    super('Interrupted');
    this.name = 'Interrupted';
  }
}
export const isInterrupted = (error: unknown) => (error as Error | null)?.name === 'Interrupted';

export async function chat(
  _messages: ChatMessage[],
  options: { temperature: number; maxTokens: number; thinking: boolean },
  onUpdate: (content: string, reasoning: string) => void,
): Promise<{ content: string; reasoning: string; timings: Timings }> {
  stopping = false;
  const thought = 'The user wants a simple explanation. I should cover what a vaccine contains, how the body reacts, and why the second response is faster.';
  let reasoning = '';
  if (options.thinking) {
    for (const word of thought.split(' ')) {
      if (stopping) break;
      reasoning += `${word} `;
      onUpdate('', reasoning);
      await wait(40);
    }
  }
  let content = '';
  for (const piece of SAMPLE.match(/\S+\s*/g) ?? []) {
    if (stopping) break;
    content += piece;
    onUpdate(content, reasoning);
    await wait(25);
  }
  return {
    content: content.trim(),
    reasoning: reasoning.trim(),
    timings: { used: 420, speed: 38.4, thought: options.thinking ? 3 : 0 },
  };
}

export async function complete(messages: ChatMessage[], options: { maxTokens?: number; schema?: object } = {}) {
  await wait(300);
  if (options.schema) return JSON.stringify({ facts: [] });
  return /title/i.test(messages[0]?.content ?? '') ? 'How Vaccines Work' : 'A short summary of the earlier messages.';
}
