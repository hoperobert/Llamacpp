// The browser preview has no Python of its own. `pocketPython.address` can be
// pointed at a folder holding the runtime, to try the Run screen with it.

const preview = { address: null as string | null, ready: false };
(globalThis as { pocketPython?: typeof preview }).pocketPython = preview;

export const pythonReady = () => preview.ready;

export async function installPython(onProgress: (fraction: number) => void): Promise<void> {
  for (let i = 1; i <= 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    onProgress(i / 5);
  }
  preview.ready = true;
}

export function removePython() { preview.ready = false; }

export const pythonAddress = async (): Promise<string | null> => (preview.ready ? preview.address : null);
