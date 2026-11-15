// The browser preview does not listen. `pocketVoice.say('…')` plays the part of someone speaking.

let heard: ((text: string) => void) | null = null;
let ended: ((problem?: string) => void) | null = null;

(globalThis as { pocketVoice?: object }).pocketVoice = {
  say(text: string) {
    heard?.(text);
    const end = ended;
    heard = null;
    ended = null;
    end?.();
  },
};

export async function listen(onText: (text: string) => void, onEnd: (problem?: string) => void): Promise<void> {
  heard = onText;
  ended = onEnd;
}

export function stopListening() {
  const end = ended;
  heard = null;
  ended = null;
  end?.();
}
