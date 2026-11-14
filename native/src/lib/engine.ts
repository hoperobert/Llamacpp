// Wraps llama.rn (llama.cpp built natively, running on the GPU through Metal).

import { BuildInfo, initLlama, type LlamaContext } from 'llama.rn';

let context: LlamaContext | null = null;

export const engineVersion = `b${BuildInfo.number}`;

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type Timings = {
  /** Tokens in the context after this reply. */
  used: number;
  /** Tokens generated per second. */
  speed: number;
  /** Seconds spent thinking before the answer began. 0 when the model did not think. */
  thought: number;
};

export async function loadModel(
  uri: string,
  nCtx: number,
  onProgress: (fraction: number) => void,
): Promise<{ gpu: boolean }> {
  await unloadModel();
  context = await initLlama(
    { model: uri, n_ctx: nCtx, n_batch: 512, n_gpu_layers: 99, use_mlock: false },
    (percent) => onProgress(Math.min(1, percent / 100)),
  );
  return { gpu: context.gpu };
}

export async function unloadModel() {
  const old = context;
  context = null;
  if (old) await old.release().catch(() => {});
}

export const isLoaded = () => context !== null;

export function stop() {
  context?.stopCompletion().catch(() => {});
}

/** Streams a reply. `onUpdate` receives the full text so far, not a delta. */
export async function chat(
  messages: ChatMessage[],
  options: { temperature: number; maxTokens: number; thinking: boolean },
  onUpdate: (content: string, reasoning: string) => void,
): Promise<{ content: string; reasoning: string; timings: Timings }> {
  if (!context) throw new Error('No model is loaded');
  let raw = '';
  const started = Date.now();
  let answerAt = 0;
  let sawReasoning = false;
  const result = await context.completion(
    {
      messages,
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
  const result = await context.completion({
    messages,
    jinja: true,
    enable_thinking: false,
    n_predict: options.maxTokens ?? 200,
    temperature: 0,
    ...(options.schema
      ? { response_format: { type: 'json_schema' as const, json_schema: { strict: true, schema: options.schema } } }
      : {}),
  });
  return (result.content ?? result.text ?? '').trim();
}
