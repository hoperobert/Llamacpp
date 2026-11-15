// A note of what the app was doing, kept up to date as it goes. If the app is
// closed without warning, the note is still there at the next launch and says
// what was happening: on screen or in the background, and busy with what.

export type Session = {
  /** 'active' when on screen, otherwise 'inactive' or 'background'. */
  phase: string;
  /** When that began. */
  since: number;
  /** What the app was busy with, if anything. */
  doing: string[];
  /** The model that was loaded, and the context it was given. */
  model: string | null;
  modelId?: string | null;
  nCtx?: number;
  /** Memory warnings from iOS since the app was last on screen. */
  warnings: number;
};

function ago(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} days`;
}

/** How the last run ended, in a line. Empty on a first launch. */
export function describeClose(previous: Session | null, now: number): string {
  if (!previous) return '';
  const details = [
    previous.doing.length ? previous.doing.join(' and ') : 'idle',
    previous.model ? `${previous.model} loaded` : 'no model loaded',
    previous.warnings ? `${previous.warnings} memory warning${previous.warnings === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(', ');
  // Closed while on screen is a crash. Closed in the background is usually iOS making room.
  if (previous.phase === 'active') return `Last closed on screen: ${details}`;
  return `Last closed in the background: ${details}. Reopened after ${ago(now - previous.since)}`;
}
