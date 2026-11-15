// Does what assistant.ts worked out was asked for, with the iPhone's own
// apps and frameworks: Reminders, Calendar, Messages, Mail, Phone, Maps,
// Contacts, Location. Each one asks iOS for permission the first time it is
// used, and never before.

import { Linking } from 'react-native';
import * as Calendar from 'expo-calendar';
import { Contact } from 'expo-contacts';
import * as Contacts from 'expo-contacts';
import * as Location from 'expo-location';
import * as MailComposer from 'expo-mail-composer';
import * as Notifications from 'expo-notifications';
import * as SMS from 'expo-sms';
import { sayWhen, type Action, type Lookup } from './assistant';

export type Outcome = { ok: boolean; note: string };

const done = (note: string): Outcome => ({ ok: true, note });
const failed = (note: string): Outcome => ({ ok: false, note });

const two = (n: number) => String(n).padStart(2, '0');
const clock = (date: Date) => `${two(date.getHours())}:${two(date.getMinutes())}`;

/** A phone number or an email address for a name, from Contacts. A number or address typed out is used as it is. */
async function reach(name: string, by: 'phone' | 'email'): Promise<{ name: string; address: string } | null> {
  if (by === 'phone' && /^[+\d][\d\s()-]{4,}$/.test(name)) return { name, address: name.replace(/[\s()-]/g, '') };
  if (by === 'email' && /^\S+@\S+\.\S+$/.test(name)) return { name, address: name };
  const allowed = await Contacts.requestPermissionsAsync().catch(() => null);
  if (!allowed?.granted) return null;
  const found = await Contact.getAll({ name, limit: 8 }).catch(() => []);
  for (const contact of found) {
    const address = by === 'phone'
      ? (await contact.getPhones().catch(() => []))[0]?.number
      : (await contact.getEmails().catch(() => []))[0]?.address;
    if (address) return { name: (await contact.getFullName().catch(() => '')) || name, address };
  }
  return null;
}

/** Carries out an action the user has approved. */
export async function perform(action: Action): Promise<Outcome> {
  try {
    switch (action.kind) {
      case 'reminder': {
        const allowed = await Calendar.requestRemindersPermissions();
        if (!allowed.granted) return failed('Allow Reminders for Pocket LLM in Settings, then try again.');
        const lists = await Calendar.getCalendars(Calendar.EntityTypes.REMINDER);
        const list = lists.find((l) => l.allowsModifications) ?? lists[0];
        if (!list) return failed('There is no reminders list to add to.');
        const due = action.at ? new Date(action.at) : null;
        await list.createReminder({
          title: action.title,
          ...(due ? { dueDate: due, alarms: [{ absoluteDate: due.toISOString() }] } : {}),
        });
        return done(due ? `Added to Reminders for ${sayWhen(action.at!, Date.now()).toLowerCase()}.` : 'Added to Reminders.');
      }
      case 'timer': {
        const now = await Notifications.getPermissionsAsync();
        const allowed = now.granted ? now : await Notifications.requestPermissionsAsync();
        if (!allowed.granted) return failed('Allow notifications for Pocket LLM in Settings, so the timer can tell you when it is done.');
        await Notifications.scheduleNotificationAsync({
          content: {
            title: action.title === 'Timer' ? 'Timer done' : action.title,
            body: action.title === 'Timer' ? 'Time is up.' : 'Timer done.',
            sound: true,
            interruptionLevel: 'timeSensitive',
            data: { timer: true },
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(action.at) },
        });
        return done(`Timer set. It goes off at ${clock(new Date(action.at))}.`);
      }
      case 'event': {
        // Adding needs no sight of what is already in the calendar.
        const allowed = await Calendar.requestCalendarPermissions(true);
        if (!allowed.granted) return failed('Allow Calendar for Pocket LLM in Settings, then try again.');
        const start = new Date(action.at);
        await Calendar.getDefaultCalendarSync().createEvent({
          title: action.title, startDate: start, endDate: new Date(action.at + action.minutes * 60000),
        });
        return done(`Added to your calendar for ${sayWhen(action.at, Date.now()).toLowerCase()}.`);
      }
      case 'message': {
        if (!(await SMS.isAvailableAsync())) return failed('This device cannot send messages.');
        const who = await reach(action.to, 'phone');
        // With nobody found the message still opens, for the name to be put in by hand.
        const { result } = await SMS.sendSMSAsync(who ? [who.address] : [], action.body);
        return result === 'cancelled' ? failed('Not sent.') : done(who ? `Message to ${who.name} sent.` : 'Message sent.');
      }
      case 'email': {
        const who = await reach(action.to, 'email');
        if (await MailComposer.isAvailableAsync()) {
          const { status } = await MailComposer.composeAsync({
            recipients: who ? [who.address] : [], subject: action.subject, body: action.body,
          });
          return status === 'cancelled' ? failed('Not sent.') : status === 'saved' ? done('Saved as a draft.') : done(who ? `Email to ${who.name} sent.` : 'Email sent.');
        }
        // No account in Mail: hand it to whichever app deals with email.
        await Linking.openURL(
          `mailto:${who?.address ?? ''}?subject=${encodeURIComponent(action.subject)}&body=${encodeURIComponent(action.body)}`,
        );
        return done('Opened in your email app.');
      }
      case 'call': {
        const who = await reach(action.to, 'phone');
        if (!who) return failed(`No phone number found for ${action.to} in Contacts.`);
        await Linking.openURL(`tel:${who.address.replace(/[^\d+]/g, '')}`);
        return done(`Calling ${who.name}.`);
      }
      case 'directions':
        await Linking.openURL(`https://maps.apple.com/?daddr=${encodeURIComponent(action.to)}`);
        return done('Opened in Maps.');
    }
  } catch (e) {
    return failed(`That did not work. ${String((e as Error)?.message ?? e)}`);
  }
}

/**
 * Reads what a question is about from the phone, as text for the model to
 * answer from. Null when there is no permission, which the answer then says.
 */
export async function read(lookup: Lookup): Promise<{ from: string; text: string } | null> {
  try {
    switch (lookup.kind) {
      case 'calendar': {
        const allowed = await Calendar.requestCalendarPermissions();
        if (!allowed.granted) return null;
        const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
        const events = await Calendar.listEvents(calendars, new Date(lookup.from), new Date(lookup.to));
        const lines = events
          .map((event) => ({ event, start: new Date(event.startDate) }))
          .sort((a, b) => a.start.getTime() - b.start.getTime())
          .slice(0, 40)
          .map(({ event, start }) => {
            const day = start.toDateString().slice(0, 10);
            const time = event.allDay ? 'all day' : `${clock(start)} to ${clock(new Date(event.endDate))}`;
            return `- ${day}, ${time}: ${event.title || 'Untitled'}${event.location ? ` (${event.location})` : ''}`;
          });
        return {
          from: 'Calendar',
          text: lines.length ? `Events in the user's calendar for ${lookup.label}:\n${lines.join('\n')}` : `The user's calendar has no events for ${lookup.label}.`,
        };
      }
      case 'reminders': {
        const allowed = await Calendar.requestRemindersPermissions();
        if (!allowed.granted) return null;
        const lists = await Calendar.getCalendars(Calendar.EntityTypes.REMINDER);
        const all = (await Promise.all(lists.map((list) => list.listReminders(null, null, Calendar.ReminderStatus.INCOMPLETE).catch(() => [])))).flat();
        const lines = all.slice(0, 40).map((reminder) => {
          const due = reminder.dueDate ? new Date(reminder.dueDate) : null;
          return `- ${reminder.title || 'Untitled'}${due ? ` (due ${due.toDateString().slice(0, 10)} ${clock(due)})` : ''}`;
        });
        return {
          from: 'Reminders',
          text: lines.length ? `The user's reminders that are not done yet:\n${lines.join('\n')}` : 'The user has no reminders waiting.',
        };
      }
      case 'location': {
        const allowed = await Location.requestForegroundPermissionsAsync();
        if (!allowed.granted) return null;
        const position = (await Location.getLastKnownPositionAsync({ maxAge: 5 * 60000 }))
          ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
        const { latitude, longitude } = position.coords;
        // Turning that into an address is done by Apple, and needs a connection.
        const [place] = await Location.reverseGeocodeAsync({ latitude, longitude }).catch(() => []);
        const address = place
          ? [place.name, place.street && place.street !== place.name ? place.street : null, place.district, place.city, place.region, place.postalCode, place.country]
            .filter((part, i, parts) => part && parts.indexOf(part) === i).join(', ')
          : '';
        return {
          from: 'Location',
          text: `Where the user is right now: ${address || 'address not known'} (latitude ${latitude.toFixed(4)}, longitude ${longitude.toFixed(4)}).`,
        };
      }
    }
  } catch {
    return null;
  }
}

/** What to say when iOS has not allowed something to be read. */
export const NOT_ALLOWED: Record<Lookup['kind'], string> = {
  calendar: 'Pocket LLM is not allowed to see your calendar. You can allow it in Settings.',
  reminders: 'Pocket LLM is not allowed to see your reminders. You can allow it in Settings.',
  location: 'Pocket LLM is not allowed to see where you are. You can allow it in Settings.',
};
