// Wraps llama.rn (llama.cpp built natively, running on the GPU through Metal).

import { AppState } from 'react-native';
import { BuildInfo, initLlama, loadLlamaModelInfo, type LlamaContext } from 'llama.rn';
import { imageUri } from './images';
import { splitThinking } from './text';

let context: LlamaContext | null = null;
let vision = false;
/** Whether the loaded model was put on the GPU. Off the GPU it is slower, but may run in the background. */
let onGPU = true;
/** Set when whatever the model was doing was told to stop. */
let cut = false;

/**
 * iOS closes an app that uses the GPU in the background. So nothing is asked of
 * a model on the GPU unless the app is on screen, and this is the one place
 * that checks. A model loaded on the processor alone may run at any time.
 */
const onScreen = () => AppState.currentState === 'active' || !onGPU;

/** True for a model on the GPU: one that must stop when the app leaves the screen. */
export const usesGPU = () => onGPU;

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

/** The details stored in a model file, without loading the model. Null if they cannot be read. */
export async function modelDetails(uri: string): Promise<Record<string, unknown> | null> {
  try {
    return (await loadLlamaModelInfo(uri)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Loads a model. With a projector file, the model can also look at photos;
 * if that part fails the model still loads and simply cannot see them.
 */
export async function loadModel(
  uri: string,
  nCtx: number,
  onProgress: (fraction: number) => void,
  projectorUri?: string,
  /** Keep it off the GPU. Slower, but iOS lets it run while the app is in the background. */
  cpu = false,
): Promise<{ gpu: boolean; vision: boolean }> {
  await unloadModel();
  onGPU = !cpu;
  context = await initLlama(
    {
      model: uri, n_ctx: nCtx, n_batch: 512, n_gpu_layers: cpu ? 0 : 99,
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
      vision = await context.initMultimodal({ path: projectorUri, use_gpu: !cpu });
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
  // The engine says this gives back a promise. It gives back nothing, so
  // calling .catch on the result threw, and an error thrown here (it runs
  // every time the app leaves the screen) closes the app. Nothing it returns
  // is needed, and nothing it throws may escape.
  try {
    void context?.stopCompletion();
  } catch {
    // Stopping is best effort.
  }
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
      // The engine does not recognise every model's way of marking its thinking,
      // so what it calls the answer is gone through once more.
      const said = splitThinking(parsed ? data.content ?? '' : raw);
      const content = said.content;
      const reasoning = [data.reasoning_content ?? '', said.reasoning].filter(Boolean).join('\n\n');
      if (reasoning) sawReasoning = true;
      if (content && !answerAt) answerAt = Date.now();
      onUpdate(content, reasoning);
    },
  );
  const t = result.timings;
  const said = splitThinking(result.content ?? result.text ?? '');
  const reasoning = [(result.reasoning_content ?? '').trim(), said.reasoning].filter(Boolean).join('\n\n');
  return {
    content: said.content,
    reasoning,
    timings: {
      used: (t?.cache_n ?? 0) + (t?.prompt_n ?? 0) + (t?.predicted_n ?? 0),
      speed: t?.predicted_per_second ?? 0,
      thought: (sawReasoning || reasoning) && answerAt ? Math.max(1, Math.round((answerAt - started) / 1000)) : 0,
    },
  };
}

// A mark that will not be found in anything a person or a model writes.
const CONTINUE_HERE = '\u2063pocket\u2063continue\u2063here\u2063';

/**
 * Carries on a reply that was cut off, from the exact word where it stopped.
 * iOS does not let an iPhone app use the GPU in the background, so a reply
 * has to stop when the app is left; this is what makes that invisible on
 * return.
 *
 * The conversation is written out the way the model reads it, with the reply
 * so far as its last turn, and everything the model's format puts after that
 * turn is cut away. The model then simply keeps writing.
 */
export async function continueChat(
  messages: ChatMessage[],
  written: string,
  options: { temperature: number; maxTokens: number },
  onUpdate: (content: string) => void,
): Promise<{ content: string; timings: Timings }> {
  if (!context) throw new Error('No model is loaded');
  if (!onScreen()) throw new Interrupted();
  // A photo takes its own place in what the model reads, which this way of writing it out does not keep.
  if (vision && messages.some((m) => m.image)) throw new Error('A reply about a photo cannot be carried on');
  const formatted = await context.getFormattedChat(
    [...messages.map(({ role, content }) => ({ role, content })), { role: 'assistant', content: CONTINUE_HERE }],
    null,
    { jinja: true, enable_thinking: false, add_generation_prompt: false },
  );
  const whole = (formatted as { prompt?: string }).prompt ?? '';
  const at = whole.lastIndexOf(CONTINUE_HERE);
  if (at < 0) throw new Error('This model cannot carry on a reply');
  if (!onScreen()) throw new Interrupted();
  let more = '';
  const result = await context.completion(
    { prompt: whole.slice(0, at) + written, n_predict: options.maxTokens, temperature: options.temperature },
    (data) => {
      more += data.token;
      onUpdate(splitThinking(written + more).content);
    },
  );
  const t = result.timings;
  return {
    content: splitThinking(written + (result.text ?? more)).content,
    timings: {
      used: (t?.cache_n ?? 0) + (t?.prompt_n ?? 0) + (t?.predicted_n ?? 0),
      speed: t?.predicted_per_second ?? 0,
      thought: 0,
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
