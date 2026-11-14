// The models offered in the app, and how well each one suits this device.

export type Group = 'fast' | 'smart' | 'large' | 'unfiltered' | 'custom';

export type Model = {
  id: string;
  name: string;
  note: string;
  /** Download size. 0 when unknown (a model added by link). */
  sizeMB: number;
  file: string;
  url: string;
  group: Group;
};

export const GROUPS: { id: Group; title: string; footer?: string }[] = [
  { id: 'fast', title: 'Fast' },
  { id: 'smart', title: 'Smarter' },
  { id: 'large', title: 'Largest', footer: 'These need an iPhone with 12 GB of memory.' },
  {
    id: 'unfiltered',
    title: 'Unfiltered',
    footer: 'Community edits with the refusal behaviour removed. They answer anything, and can be a little less accurate.',
  },
  { id: 'custom', title: 'Added by you' },
];

export const MODELS: Model[] = [
  {
    id: 'qwen35-0.8b',
    name: 'Qwen3.5 0.8B',
    note: 'The fastest. Good for quick questions.',
    sizeMB: 563,
    file: 'Qwen3.5-0.8B-Q4_0.gguf',
    url: 'https://huggingface.co/ggml-org/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_0.gguf',
    group: 'fast',
  },
  {
    id: 'lfm3-1.7b',
    name: 'LFM3 1.7B',
    note: 'Built for phones. Fast for its quality.',
    sizeMB: 1100,
    file: 'LFM3-1.7B-Q4_K_M.gguf',
    url: 'https://huggingface.co/LiquidAI/LFM3-1.7B-GGUF/resolve/main/LFM3-1.7B-Q4_K_M.gguf',
    group: 'fast',
  },
  {
    id: 'qwen35-2b',
    name: 'Qwen3.5 2B',
    note: 'A good balance of speed and quality.',
    sizeMB: 1281,
    file: 'Qwen3.5-2B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf',
    group: 'fast',
  },
  {
    id: 'qwen38-2b-distill',
    name: 'Qwen3.8 2B Distilled',
    note: 'Qwen3.5 2B retrained on Qwen3.8 answers. Always thinks first.',
    sizeMB: 1312,
    file: 'Qwen3.8-2B-Q4_K_M.gguf',
    url: 'https://huggingface.co/empero-ai/Qwen3.8-2B-Distill-GGUF/resolve/main/Qwen3.8-2B-Q4_K_M.gguf',
    group: 'fast',
  },
  {
    id: 'spark-x26-1.7b',
    name: 'Spark-X2.6 1.7B',
    note: 'New in October 2026. Strong for its size.',
    sizeMB: 1769,
    file: 'Spark-X2.6-1.7B-Q4_K_M.gguf',
    url: 'https://huggingface.co/XHToken/Spark-X2.6-1.7B-GGUF/resolve/main/Spark-X2.6-1.7B-Q4_K_M.gguf',
    group: 'fast',
  },
  {
    id: 'gemma4-e2b',
    name: 'Gemma 4 E2B',
    note: 'From Google. Careful, well-rounded answers.',
    sizeMB: 2841,
    file: 'gemma-4-E2B-it-Q4_0.gguf',
    url: 'https://huggingface.co/ggml-org/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_0.gguf',
    group: 'smart',
  },
  {
    id: 'qwen35-4b',
    name: 'Qwen3.5 4B',
    note: 'The best all-rounder for most iPhones.',
    sizeMB: 3032,
    file: 'Qwen3.5-4B-Q4_K_M.gguf',
    url: 'https://huggingface.co/ggml-org/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf',
    group: 'smart',
  },
  {
    id: 'qwen38-4b-distill',
    name: 'Qwen3.8 4B Distilled',
    note: 'Qwen3.5 4B retrained on Qwen3.8 answers. Always thinks first.',
    sizeMB: 2783,
    file: 'Qwen3.8-4B-Q4_K_M.gguf',
    url: 'https://huggingface.co/empero-ai/Qwen3.8-4B-Distill-GGUF/resolve/main/Qwen3.8-4B-Q4_K_M.gguf',
    group: 'smart',
  },
  {
    id: 'spark-x26-4b',
    name: 'Spark-X2.6 4B',
    note: 'New in October 2026. Rated near much larger models.',
    sizeMB: 3543,
    file: 'Spark-X2.6-4B-Q4_K_M.gguf',
    url: 'https://huggingface.co/XHToken/Spark-X2.6-4B-GGUF/resolve/main/Spark-X2.6-4B-Q4_K_M.gguf',
    group: 'smart',
  },
  {
    id: 'dory10-4b',
    name: 'Nemotron Dory 1.0 4B',
    note: 'NVIDIA research model that re-reads its own work. Slow. English only.',
    sizeMB: 3673,
    file: 'NVIDIA-Nemotron-Labs-Dory1.0-4B-Q5_K_M.gguf',
    url: 'https://huggingface.co/nvidia/NVIDIA-Nemotron-Labs-Dory1.0-4B-GGUF/resolve/main/NVIDIA-Nemotron-Labs-Dory1.0-4B-Q5_K_M.gguf',
    group: 'smart',
  },
  {
    id: 'gemma4-e4b',
    name: 'Gemma 4 E4B',
    note: 'A step up from Gemma 4 E2B.',
    sizeMB: 4591,
    file: 'gemma-4-E4B-it-Q4_0.gguf',
    url: 'https://huggingface.co/ggml-org/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_0.gguf',
    group: 'large',
  },
  {
    id: 'qwen35-9b',
    name: 'Qwen3.5 9B',
    note: 'Very capable, and slow.',
    sizeMB: 5379,
    file: 'Qwen3.5-9B-Q4_0.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-Q4_0.gguf',
    group: 'large',
  },
  {
    id: 'ornith15-9b',
    name: 'Ornith 1.5 9B',
    note: 'A tuned Qwen3.5 9B that is much better at code.',
    sizeMB: 5780,
    file: 'Ornith-1.5-9B-Q4_K_M.gguf',
    url: 'https://huggingface.co/ornith-ai/Ornith-1.5-9B-GGUF/resolve/main/Ornith-1.5-9B-Q4_K_M.gguf',
    group: 'large',
  },
  {
    id: 'lfm3-1.7b-uncensored',
    name: 'LFM3 1.7B Unfiltered',
    note: 'Fast. A community edit of LFM3.',
    sizeMB: 1132,
    file: 'LFM3-1.7B-Uncensored-AD-Q4_K_M.gguf',
    url: 'https://huggingface.co/AtomicChat/LFM3-1.7B-Uncensored-GGUF/resolve/main/LFM3-1.7B-Uncensored-AD-Q4_K_M.gguf',
    group: 'unfiltered',
  },
  {
    id: 'qwen35-4b-uncensored',
    name: 'Qwen3.5 4B Unfiltered',
    note: 'The most popular edit of Qwen3.5 4B.',
    sizeMB: 2707,
    file: 'Qwen3.5-4B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf',
    url: 'https://huggingface.co/HauhauCS/Qwen3.5-4B-Uncensored-HauhauCS-Aggressive/resolve/main/Qwen3.5-4B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf',
    group: 'unfiltered',
  },
  {
    id: 'spark-x26-4b-abliterated',
    name: 'Spark-X2.6 4B Unfiltered',
    note: 'A community edit of Spark-X2.6 4B.',
    sizeMB: 2600,
    file: 'Spark-X2.6-4B-abliterated-Q4_K_M.gguf',
    url: 'https://huggingface.co/FrostWolfAI/Spark-X2.6-4B-abliterated-GGUF/resolve/main/Spark-X2.6-4B-abliterated-Q4_K_M.gguf',
    group: 'unfiltered',
  },
];

export const formatMB = (mb: number) =>
  mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`;

export type Fit = 'good' | 'tight' | 'no';

/**
 * How comfortably a model fits in this device's memory. iOS lets an app use a
 * little over half of the installed memory, and the model needs room beyond
 * its own file for the conversation.
 */
export function fit(model: Model, ramMB: number | null): Fit {
  if (!ramMB || !model.sizeMB) return 'good';
  if (model.sizeMB <= ramMB * 0.45) return 'good';
  if (model.sizeMB <= ramMB * 0.62) return 'tight';
  return 'no';
}

/** The model to suggest to someone who has not picked one yet. */
export function recommended(ramMB: number | null): Model {
  const id = !ramMB || ramMB >= 7000 ? 'qwen35-4b' : ramMB >= 5000 ? 'qwen35-2b' : 'qwen35-0.8b';
  return MODELS.find((m) => m.id === id)!;
}

/** Turns a link to a .gguf file into a model entry. Returns null if the link is not usable. */
export function modelFromUrl(input: string): Model | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  // A Hugging Face page link ("/blob/") points at a web page; "/resolve/" is the file itself.
  url.pathname = url.pathname.replace('/blob/', '/resolve/');
  const file = decodeURIComponent(url.pathname.split('/').pop() ?? '');
  if (!/\.gguf$/i.test(file)) return null;
  const safe = file.replace(/[^\w.-]/g, '_');
  return {
    id: `custom-${safe.toLowerCase()}`,
    name: safe.replace(/\.gguf$/i, '').replace(/[-_]+/g, ' '),
    note: `From ${url.hostname}`,
    sizeMB: 0,
    file: safe,
    url: url.href,
    group: 'custom',
  };
}
