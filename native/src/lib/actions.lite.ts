// For an update sent to a build of the app made before it could reach
// Reminders, Calendar or Contacts. What iOS will do from a plain link still
// works: start a message or an email, call a number, open Maps.

import { Linking } from 'react-native';
import type { Action, Lookup } from './assistant';

export type Outcome = { ok: boolean; note: string };

const NEXT = 'That comes with the next version of the app.';

export async function perform(action: Action): Promise<Outcome> {
  try {
    switch (action.kind) {
      case 'message':
        await Linking.openURL(`sms:&body=${encodeURIComponent(action.body)}`);
        return { ok: true, note: `Opened in Messages. Choose ${action.to} there.` };
      case 'email':
        await Linking.openURL(`mailto:?subject=${encodeURIComponent(action.subject)}&body=${encodeURIComponent(action.body)}`);
        return { ok: true, note: `Opened in your email app. Choose ${action.to} there.` };
      case 'call':
        await Linking.openURL(`tel:${action.to.replace(/[^\d+]/g, '')}`);
        return { ok: true, note: `Calling ${action.to}.` };
      case 'directions':
        await Linking.openURL(`https://maps.apple.com/?daddr=${encodeURIComponent(action.to)}`);
        return { ok: true, note: 'Opened in Maps.' };
      default:
        return { ok: false, note: NEXT };
    }
  } catch (e) {
    return { ok: false, note: `That did not work. ${String((e as Error)?.message ?? e)}` };
  }
}

export async function read(_lookup: Lookup): Promise<{ from: string; text: string } | null> {
  return null;
}

export const NOT_ALLOWED: Record<Lookup['kind'], string> = { calendar: NEXT, reminders: NEXT, location: NEXT };
