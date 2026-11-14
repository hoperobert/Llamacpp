export type Model = {
  id: string;
  name: string;
  note: string;
  sizeMB: number;
  file: string;
  url: string;
};

// A native app is not bound by the browser's 2 GB file limit or its tight
// memory cap, so larger models are possible here than in the web version.
export const MODELS: Model[] = [
  {
    id: 'qwen35-0.8b',
    name: 'Qwen3.5 0.8B',
    note: 'Fastest. Runs on any recent iPhone.',
    sizeMB: 563,
    file: 'Qwen3.5-0.8B-Q4_0.gguf',
    url: 'https://huggingface.co/ggml-org/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_0.gguf',
  },
  {
    id: 'lfm3-1.7b',
    name: 'LFM3 1.7B',
    note: 'Newer (Oct 2026) and built for phones. Fast for its quality.',
    sizeMB: 1100,
    file: 'LFM3-1.7B-Q4_K_M.gguf',
    url: 'https://huggingface.co/LiquidAI/LFM3-1.7B-GGUF/resolve/main/LFM3-1.7B-Q4_K_M.gguf',
  },
  {
    id: 'qwen35-2b',
    name: 'Qwen3.5 2B',
    note: 'A good balance of speed and quality.',
    sizeMB: 1281,
    file: 'Qwen3.5-2B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf',
  },
  {
    id: 'gemma4-e2b',
    name: 'Gemma 4 E2B',
    note: 'Smarter. Needs an iPhone with 8 GB of memory.',
    sizeMB: 2841,
    file: 'gemma-4-E2B-it-Q4_0.gguf',
    url: 'https://huggingface.co/ggml-org/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_0.gguf',
  },
  {
    id: 'qwen35-4b',
    name: 'Qwen3.5 4B',
    note: 'Smartest here, slowest. Needs 8 GB of memory or more.',
    sizeMB: 3032,
    file: 'Qwen3.5-4B-Q4_K_M.gguf',
    url: 'https://huggingface.co/ggml-org/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf',
  },
  {
    id: 'gemma4-e4b',
    name: 'Gemma 4 E4B',
    note: 'A step up from E2B. Needs an iPhone with 12 GB of memory.',
    sizeMB: 4591,
    file: 'gemma-4-E4B-it-Q4_0.gguf',
    url: 'https://huggingface.co/ggml-org/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_0.gguf',
  },
  {
    id: 'qwen35-9b',
    name: 'Qwen3.5 9B',
    note: 'The most capable here. Only for iPhones with 12 GB of memory, and slow.',
    sizeMB: 5379,
    file: 'Qwen3.5-9B-Q4_0.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-Q4_0.gguf',
  },
];

export const formatMB = (mb: number) =>
  mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`;
