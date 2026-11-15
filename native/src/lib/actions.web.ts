// The browser preview's stand-in: nothing is done, and what would have been
// done is kept for checks. `pocketPhone.allowed = false` plays a refusal.

import { sayWhen, type Action, type Lookup } from './assistant';

export type Outcome = { ok: boolean; note: string };

const phone = { allowed: true, performed: [] as Action[] };
(globalThis as { pocketPhone?: typeof phone }).pocketPhone = phone;

export async function perform(action: Action): Promise<Outcome> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (!phone.allowed) return { ok: false, note: 'Not allowed. You can allow it in Settings, then try again.' };
  phone.performed.push(action);
  switch (action.kind) {
    case 'reminder': return { ok: true, note: action.at ? `Added to Reminders for ${sayWhen(action.at, Date.now()).toLowerCase()}.` : 'Added to Reminders.' };
    case 'timer': return { ok: true, note: 'Timer set.' };
    case 'event': return { ok: true, note: `Added to your calendar for ${sayWhen(action.at, Date.now()).toLowerCase()}.` };
    case 'message': return { ok: true, note: `Message to ${action.to} sent.` };
    case 'email': return { ok: true, note: `Email to ${action.to} sent.` };
    case 'call': return { ok: true, note: `Calling ${action.to}.` };
    case 'directions': return { ok: true, note: 'Opened in Maps.' };
  }
}

export async function read(lookup: Lookup): Promise<{ from: string; text: string } | null> {
  if (!phone.allowed) return null;
  switch (lookup.kind) {
    case 'calendar':
      return { from: 'Calendar', text: `Events in the user's calendar for ${lookup.label}:\n- 10:00 to 11:00: Dentist\n- 19:00 to 21:00: Dinner with Ana (Lina Stores)` };
    case 'reminders':
      return { from: 'Reminders', text: "The user's reminders that are not done yet:\n- Buy milk\n- Renew passport" };
    case 'location':
      return { from: 'Location', text: 'Where the user is right now: Granary Square, London, N1C 4AA, United Kingdom (latitude 51.5353, longitude -0.1257).' };
  }
}

export const NOT_ALLOWED: Record<Lookup['kind'], string> = {
  calendar: 'Pocket LLM is not allowed to see your calendar. You can allow it in Settings.',
  reminders: 'Pocket LLM is not allowed to see your reminders. You can allow it in Settings.',
  location: 'Pocket LLM is not allowed to see where you are. You can allow it in Settings.',
};
