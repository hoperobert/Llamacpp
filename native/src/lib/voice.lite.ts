// For an update sent to a build of the app made before it could listen.

export async function listen(_onText: (text: string) => void, onEnd: (problem?: string) => void): Promise<void> {
  onEnd('That comes with the next version of the app.');
}

export function stopListening() {}
