// Speaking to the app. The words are worked out on the phone itself where it
// can do that, so what is said stays on it like everything else.

import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

let listeners: { remove(): void }[] = [];

function clear() {
  listeners.forEach((listener) => listener.remove());
  listeners = [];
}

/**
 * Listens until the speaker pauses. `onText` is given what has been heard so
 * far, again and again as it firms up. `onEnd` is called once, with what went
 * wrong if something did ('denied' when iOS has not allowed it).
 */
export async function listen(onText: (text: string) => void, onEnd: (problem?: string) => void): Promise<void> {
  try {
    const allowed = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!allowed.granted) {
      onEnd('denied');
      return;
    }
    clear();
    let over = false;
    const end = (problem?: string) => {
      if (over) return;
      over = true;
      clear();
      onEnd(problem);
    };
    listeners = [
      ExpoSpeechRecognitionModule.addListener('result', (event) => {
        const heard = event.results[0]?.transcript;
        if (heard) onText(heard);
      }),
      ExpoSpeechRecognitionModule.addListener('error', (event) => {
        // Saying nothing, or stopping by hand, is not a fault.
        end(event.error === 'no-speech' || event.error === 'aborted' ? undefined : event.message || event.error);
      }),
      ExpoSpeechRecognitionModule.addListener('end', () => end()),
    ];
    ExpoSpeechRecognitionModule.start({
      interimResults: true,
      continuous: false,
      addsPunctuation: true,
      requiresOnDeviceRecognition: ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(),
    });
  } catch (e) {
    clear();
    onEnd(String((e as Error)?.message ?? e));
  }
}

/** Stops listening and keeps what was heard. */
export function stopListening() {
  try {
    ExpoSpeechRecognitionModule.stop();
  } catch {
    // Not listening.
  }
}
