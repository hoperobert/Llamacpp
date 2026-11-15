// Wraps llama.rn (llama.cpp built natively, running on the GPU through Metal).

import { AppState } from 'react-native';
import { BuildInfo, initLlama, type LlamaContext } from 'llama.rn';
import { imageUri } from './images';

let context: LlamaContext | null = null;
let vision = false;
/** Set when whatever the model was doing was told to stop. */
let cut = false;

/**
 * iOS closes an app that uses the GPU in the background. So nothing is asked of
 * the model unless the app is on screen, and this is the one place that checks.
 */
const onScreen = () => AppState.currentState === 'active';

/** The model was not asked, because the app is off screen, or its answer was cut short and is no use. */
export class Interrupted extends Error {
  constructor() {
    super('Interrupted');
    this.name = 'Interrupted';
  }
}

export const isInterrupted = (error: unknown) => (error as Error | null)?.name === 'Interrupted';

export const engineVersion = `b${BuildInfo.number}`;

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string; image?: string };

export type Timings = {
  /** Tokens in the context after this reply. */
  used: number;
  /** Tokens generated per second. */
  speed: number;
  /** Seconds spent thinking before the answer began. 0 when the model did not think. */
  thought: number;
};

/**
 * Loads a model. With a projector file, the model can also look at photos;
 * if that part fails the model still loads and simply cannot see them.
 */
export async function loadModel(
  uri: string,
  nCtx: number,
  onProgress: (fraction: number) => void,
  projectorUri?: string,
): Promise<{ gpu: boolean; vision: boolean }> {
  await unloadModel();
  context = await initLlama(
    {
      model: uri, n_ctx: nCtx, n_batch: 512, n_gpu_layers: 99,
      // The model is mapped from its file and never pinned, so iOS can page it
      // out when the app is in the background instead of closing the app.
      use_mmap: true, use_mlock: false,
      // Photos take a fixed place in the context, so it cannot be shifted along.
      ...(projectorUri ? { ctx_shift: false } : {}),
    },
    (percent) => onProgress(Math.min(1, percent / 100)),
  );
  if (projectorUri) {
    try {
      vision = await context.initMultimodal({ path: projectorUri, use_gpu: true });
    } catch {
      vision = false;
    }
  }
  return { gpu: context.gpu, vision };
}

export async function unloadModel() {
  const old = context;
  context = null;
  vision = false;
  if (old) await old.release().catch(() => {});
}

export const isLoaded = () => context !== null;

export function stop() {
  cut = true;
  context?.stopCompletion().catch(() => {});
}

/** Streams a reply. `onUpdate` receives the full text so far, not a delta. */
export async function chat(
  messages: ChatMessage[],
  options: { temperature: number; maxTokens: number; thinking: boolean },
  onUpdate: (content: string, reasoning: string) => void,
): Promise<{ content: string; reasoning: string; timings: Timings }> {
  if (!context) throw new Error('No model is loaded');
  if (!onScreen()) throw new Interrupted();
  let raw = '';
  const started = Date.now();
  let answerAt = 0;
  let sawReasoning = false;
  const result = await context.completion(
    {
      // A photo is only passed on when the loaded model can look at it.
      messages: messages.map((m) => (m.image && vision
        ? {
          role: m.role,
          content: [
            { type: 'text', text: m.content || 'What is in this photo?' },
            { type: 'image_url', image_url: { url: imageUri(m.image) } },
          ],
        }
        : { role: m.role, content: m.content || '(a photo this model cannot see)' })),
      jinja: true,
      enable_thinking: options.thinking,
      reasoning_format: 'auto',
      n_predict: options.maxTokens,
      temperature: options.temperature,
    },
    (data) => {
      raw += data.token;
      // With a chat template, llama.rn reports the parsed text so far.
      const parsed = data.content !== undefined || data.reasoning_content !== undefined;
      const content = parsed ? data.content ?? '' : raw;
      const reasoning = data.reasoning_content ?? '';
      if (reasoning) sawReasoning = true;
      if (content && !answerAt) answerAt = Date.now();
      onUpdate(content, reasoning);
    },
  );
  const t = result.timings;
  const reasoning = (result.reasoning_content ?? '').trim();
  return {
    content: (result.content ?? result.text ?? '').trim(),
    reasoning,
    timings: {
      used: (t?.cache_n ?? 0) + (t?.prompt_n ?? 0) + (t?.predicted_n ?? 0),
      speed: t?.predicted_per_second ?? 0,
      thought: (sawReasoning || reasoning) && answerAt ? Math.max(1, Math.round((answerAt - started) / 1000)) : 0,
    },
  };
}

/** One-shot completion for background jobs (summaries, titles, memory extraction). */
export async function complete(
  messages: ChatMessage[],
  options: { maxTokens?: number; schema?: object } = {},
): Promise<string> {
  if (!context) throw new Error('No model is loaded');
  if (!onScreen()) throw new Interrupted();
  cut = false;
  const result = await context.completion({
    messages: messages.map(({ role, content }) => ({ role, content })),
    jinja: true,
    enable_thinking: false,
    n_predict: options.maxTokens ?? 200,
    temperature: 0,
    ...(options.schema
      ? { response_format: { type: 'json_schema' as const, json_schema: { strict: true, schema: options.schema } } }
      : {}),
  });
  // Half a title or half a summary is worse than none.
  if (cut) throw new Interrupted();
  return (result.content ?? result.text ?? '').trim();
}
