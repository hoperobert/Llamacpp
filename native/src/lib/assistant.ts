// Things the app can do on the phone when asked in plain words: set a
// reminder or a timer, add an event, start a message, an email or a call, get
// directions; and things it can look at to answer a question: the calendar,
// reminders, where the phone is.
//
// What was asked for is worked out here by rule, not by the model. A small
// model gets dates wrong; rules do not, and they cost no time. Nothing is done
// without being shown first and approved.
//
// Nothing here touches the phone, so the tests use it as it is.

export type Action =
  | { kind: 'reminder'; title: string; at: number | null }
  | { kind: 'timer'; title: string; at: number }
  | { kind: 'event'; title: string; at: number; minutes: number }
  | { kind: 'message'; to: string; body: string }
  | { kind: 'email'; to: string; subject: string; body: string }
  | { kind: 'call'; to: string }
  | { kind: 'directions'; to: string };

/** Something to read from the phone before answering. */
export type Lookup =
  | { kind: 'calendar'; from: number; to: number; label: string }
  | { kind: 'reminders' }
  | { kind: 'location' };

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty-five': 45, sixty: 60, ninety: 90,
};
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH = `(${MONTHS.join('|')}|${MONTHS.map((m) => m.slice(0, 3)).join('|')})`;

const startOfDay = (time: number) => {
  const d = new Date(time);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/**
 * Finds when something is meant to happen in a sentence: "tomorrow at 9",
 * "in 20 minutes", "on Friday at 3:30pm", "on 3 December". Returns the time
 * and the sentence without those words, or null if it names no time.
 */
export function findWhen(text: string, now: number): { at: number; rest: string; timed: boolean } | null {
  let rest = ` ${text} `;
  const take = (pattern: RegExp): RegExpMatchArray | null => {
    const match = rest.match(pattern);
    if (match) rest = rest.replace(match[0], ' ');
    return match;
  };

  // "in 20 minutes", "in an hour and a half", "in half an hour", "in 2 days"
  const half = take(/\s(?:in|for)\s+half\s+an?\s+hour\b/i);
  if (half) return { at: now + 30 * MINUTE, rest: tidy(rest), timed: true };
  const span = take(/\s(?:in|for)\s+(\d+(?:\.\d+)?|[a-z-]+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?)(\s+and\s+a\s+half)?\b/i);
  if (span) {
    const count = /^\d/.test(span[1]) ? Number(span[1]) : NUMBERS[span[1].toLowerCase()];
    if (count) {
      const unit = span[2].toLowerCase();
      const size = unit.startsWith('s') ? 1000 : unit.startsWith('m') ? MINUTE : unit.startsWith('h') ? 60 * MINUTE : unit.startsWith('d') ? DAY : 7 * DAY;
      return { at: now + (count + (span[3] ? 0.5 : 0)) * size, rest: tidy(rest), timed: !/^(d|w)/.test(unit) };
    }
    rest = ` ${text} `;
  }

  // The day.
  let day: number | null = null;
  let evening = false;
  if (take(/\s(?:the\s+)?day\s+after\s+tomorrow\b/i)) day = startOfDay(now) + 2 * DAY;
  else if (take(/\stomorrow\b/i)) day = startOfDay(now) + DAY;
  else if (take(/\stonight\b/i)) { day = startOfDay(now); evening = true; }
  else if (take(/\s(?:today|this\s+(?:morning|afternoon))\b/i)) day = startOfDay(now);
  else if (take(/\sthis\s+evening\b/i)) { day = startOfDay(now); evening = true; }
  else {
    const weekday = take(new RegExp(`\\s(?:on\\s+|this\\s+|next\\s+)?(${WEEKDAYS.join('|')})\\b`, 'i'));
    const dated = weekday ? null
      : take(new RegExp(`\\s(?:on\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+${MONTH}\\b(?:\\s+(\\d{4}))?`, 'i'))
        ?? take(new RegExp(`\\s(?:on\\s+)?${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, 'i'));
    if (weekday) {
      const wanted = WEEKDAYS.indexOf(weekday[1].toLowerCase());
      const ahead = (wanted - new Date(now).getDay() + 7) % 7 || 7;
      day = startOfDay(now) + ahead * DAY;
      // Across a change of the clocks a day is not 24 hours long.
      day = startOfDay(day + 2 * 60 * MINUTE);
    } else if (dated) {
      const dayFirst = /^\d/.test(dated[1]);
      const date = Number(dayFirst ? dated[1] : dated[2]);
      const month = MONTHS.findIndex((m) => m.startsWith((dayFirst ? dated[2] : dated[1]).toLowerCase().slice(0, 3)));
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setMonth(month, date);
      if (dated[3]) d.setFullYear(Number(dated[3]));
      // A date that has gone by this year means next year.
      else if (d.getTime() < startOfDay(now)) d.setFullYear(d.getFullYear() + 1);
      day = d.getTime();
    }
  }

  // The time of day.
  let minutes: number | null = null;
  // "at 9" could be morning or evening. "at 9am" and "at 21:00" could not.
  let eitherHalf = false;
  if (take(/\s(?:at\s+)?(?:noon|midday)\b/i)) minutes = 12 * 60;
  else if (take(/\s(?:at\s+)?midnight\b/i)) minutes = 24 * 60;
  else {
    const clock = take(/\s(?:at|by|for)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?(?:\s+o'?clock)?(?=[\s,.!?])/i)
      ?? take(/\s(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?=[\s,.!?])/i)
      ?? take(/\s(\d{1,2}):(\d{2})()(?=[\s,.!?])/);
    if (clock) {
      let hour = Number(clock[1]);
      const minute = Number(clock[2] ?? 0);
      const half = (clock[3] ?? '').toLowerCase().replace(/\./g, '');
      if (hour > 24 || minute > 59) return null;
      if (half === 'pm' && hour < 12) hour += 12;
      else if (half === 'am' && hour === 12) hour = 0;
      // "at 7" with nothing else: the next 7 o'clock there is, and in the evening for "tonight".
      else if (!half && hour < 12 && (evening || (day === null && hour <= 7))) hour += 12;
      else if (!half && hour >= 1 && hour < 12 && clock[2] === undefined) eitherHalf = true;
      minutes = hour * 60 + minute;
    } else if (take(/\s(?:in\s+the\s+)?morning\b/i)) minutes = 9 * 60;
    else if (take(/\s(?:in\s+the\s+)?afternoon\b/i)) minutes = 15 * 60;
    else if (take(/\s(?:in\s+the\s+)?evening\b/i)) minutes = 19 * 60;
  }

  if (day === null && minutes === null) return null;
  const timed = minutes !== null || evening;
  if (minutes === null) minutes = evening ? 19 * 60 : 9 * 60;
  let at = new Date(day ?? startOfDay(now)).setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  // A time with no day that has gone by today means tomorrow. A 12-hour time with no am or pm, later today.
  if (day === null && at <= now) {
    at += eitherHalf && at + 12 * 60 * MINUTE > now ? 12 * 60 * MINUTE : DAY;
  }
  return { at, rest: tidy(rest), timed };
}

const tidy = (text: string) =>
  text.replace(/\s+/g, ' ').replace(/\s+([,.!?])/g, '$1').replace(/^[\s,]+|[\s,]+$/g, '').replace(/\s+(?:at|on|by|for|in)$/i, '');

const sentence = (text: string) => {
  const clean = tidy(text).replace(/[.!]+$/, '');
  return clean ? clean[0].toUpperCase() + clean.slice(1) : '';
};

const POLITE = /^(?:(?:hey|hi|ok|okay|please|can you|could you|would you|will you|i need you to|i want you to|i'd like you to)[\s,]+)+/i;

/**
 * What a message asks the app to do, if anything. Rules are kept tight: a
 * question that merely mentions a reminder is still a question for the model.
 */
export function findAction(message: string, now: number): Action | null {
  const text = message.trim().replace(POLITE, '').replace(/\s*(?:please|thanks|thank you)[.!]*$/i, '');
  if (!text || text.length > 300 || text.includes('\n')) return null;
  let m: RegExpMatchArray | null;

  // ----- timers -----
  if ((m = text.match(/^(?:set|start)\s+(?:a|an|the)?\s*(?:(.+?)\s+)?timer\b(.*)$/i)) || (m = text.match(/^()timer\b(.*)$/i))) {
    const when = findWhen(` ${m[2]}`.replace(/\sof\s/i, ' for '), now) ?? findWhen(` for ${m[1] ?? ''}`, now);
    if (!when) return null;
    const named = /^\d/.test(m[1] ?? '') || /minute|hour|second/i.test(m[1] ?? '') ? '' : m[1] ?? '';
    const label = when.rest.match(/(?:called|named|to|for)\s+(.+)$/i)?.[1] ?? named;
    return { kind: 'timer', title: sentence(label) || 'Timer', at: when.at };
  }

  // ----- reminders -----
  if (
    (m = text.match(/^remind\s+me\s+(.+)$/i)) ||
    (m = text.match(/^(?:set|add|create|make)\s+(?:a|an|me\s+a)\s+reminder\s+(.+)$/i)) ||
    (m = text.match(/^(?:add|put)\s+(.+?)\s+(?:to|on|in)\s+my\s+reminders$/i))
  ) {
    const when = findWhen(m[1], now);
    const what = (when ? when.rest : m[1]).replace(/^(?:to|about|that|for|of)\s+/i, '');
    const title = sentence(what.replace(/\s+(?:to|about|that)$/i, ''));
    return title ? { kind: 'reminder', title, at: when?.at ?? null } : null;
  }

  // ----- calendar events -----
  if (
    (m = text.match(/^(?:add|put|schedule|create|book|make)\s+(?:an?\s+|the\s+|my\s+)?(.+?)\s+(?:to|on|in)\s+(?:my\s+|the\s+)?calendar\b(.*)$/i)) ||
    (m = text.match(/^(?:schedule|book)\s+(?:an?\s+|the\s+|my\s+)?(.+)$/i)) ||
    (m = text.match(/^(?:add|create|make)\s+(?:an?\s+)?(?:calendar\s+)?(?:event|appointment|meeting)\s+(.+)$/i))
  ) {
    const all = `${m[1]} ${m[2] ?? ''}`;
    const lasting = all.match(/\sfor\s+(\d+|an?|two|three)\s*(hours?|hrs?|minutes?|mins?)\b/i);
    const minutes = lasting
      ? (/^\d/.test(lasting[1]) ? Number(lasting[1]) : NUMBERS[lasting[1].toLowerCase()]) * (lasting[2].toLowerCase().startsWith('h') ? 60 : 1)
      : 60;
    const when = findWhen(lasting ? all.replace(lasting[0], ' ') : all, now);
    if (!when) return null;
    const title = sentence(when.rest.replace(/^(?:event|appointment|meeting)\s+(?:called|named|for|about)\s+/i, '').replace(/^(?:called|named|for|about)\s+/i, ''));
    return title ? { kind: 'event', title, at: when.at, minutes } : null;
  }

  // ----- messages, email, calls -----
  if ((m = text.match(/^(?:text|message|imessage|sms)\s+(.+)$/i)) || (m = text.match(/^send\s+(?:a\s+)?(?:text|message|imessage|sms)\s+to\s+(.+)$/i))) {
    const parts = splitRecipient(m[1]);
    return parts ? { kind: 'message', to: parts.to, body: sentence(parts.body) } : null;
  }
  if ((m = text.match(/^(?:email|e-mail|mail)\s+(.+)$/i)) || (m = text.match(/^send\s+(?:an?\s+)?(?:email|e-mail)\s+to\s+(.+)$/i))) {
    const parts = splitRecipient(m[1]);
    if (!parts) return null;
    const about = parts.body.match(/^about\s+(.+)$/i);
    return { kind: 'email', to: parts.to, subject: about ? sentence(about[1]) : '', body: about ? '' : sentence(parts.body) };
  }
  if ((m = text.match(/^(?:call|ring|phone|dial)\s+(.+)$/i))) {
    const to = m[1].replace(/[.!?]+$/, '').trim();
    // "call it a day", "call me when…" and the like are not phone calls.
    if (/^(?:it|this|that|me|us|them|him|her)\b/i.test(to) || to.split(/\s+/).length > 4) return null;
    return { kind: 'call', to: properName(to) };
  }

  // ----- directions -----
  if (
    (m = text.match(/^(?:get\s+|give\s+me\s+|show\s+me\s+)?directions\s+to\s+(.+)$/i)) ||
    (m = text.match(/^(?:navigate|take\s+me|drive\s+me)\s+to\s+(.+)$/i)) ||
    (m = text.match(/^how\s+do\s+i\s+get\s+to\s+(.+)$/i))
  ) {
    const to = m[1].replace(/[.!?]+$/, '').trim();
    return to ? { kind: 'directions', to: sentence(to) } : null;
  }
  return null;
}

/** "Mum I'm running late", "John saying see you at 8", "Dr Patel: the results are in". */
function splitRecipient(text: string): { to: string; body: string } | null {
  const marked = text.match(/^(.+?)(?:\s*[:,]\s+|\s+(?:saying|to\s+say|that|and\s+(?:say|tell\s+(?:him|her|them)))\s+(?:that\s+)?)(.+)$/i);
  if (marked && marked[1].split(/\s+/).length <= 4) return { to: properName(marked[1]), body: marked[2] };
  const about = text.match(/^(.+?)\s+(about\s+.+)$/i);
  if (about && about[1].split(/\s+/).length <= 3) return { to: properName(about[1]), body: about[2] };
  // No marker: the name is the first word, and a second one if it is capitalised like a surname.
  const words = text.split(/\s+/);
  const two = words.length > 2 && /^[A-Z][a-z'-]+$/.test(words[1]) && /^[A-Z]/.test(words[0]) && !/^I('|$)/.test(words[1]);
  const to = words.slice(0, two ? 2 : 1).join(' ').replace(/^my\s+/i, '');
  if (!to || /^(?:me|it|this|that|a|an|the)$/i.test(to)) return null;
  return { to: properName(to), body: words.slice(two ? 2 : 1).join(' ') };
}

const properName = (name: string) =>
  name.trim().replace(/^my\s+/i, '').replace(/[.!?]+$/, '').replace(/\b[a-z]/g, (letter) => letter.toUpperCase());

/** Whether a question needs something read from the phone to answer it, and what. */
export function findLookup(message: string, now: number): Lookup | null {
  const text = message.trim().toLowerCase();
  if (!text || text.length > 200) return null;
  if (/\bmy\s+(?:calendar|schedule|diary|agenda)\b|\bon\s+the\s+calendar\b|\bdo\s+i\s+have\s+(?:anything|something|any\s+(?:meetings|events|appointments|plans))\b|\bwhat(?:'s|\s+is|\s+do\s+i\s+have)\s+(?:on|planned|happening)\s+(?:today|tomorrow|this\s+week|on\s+\w+day)\b|\bam\s+i\s+(?:free|busy)\b|\bmy\s+next\s+(?:meeting|event|appointment)\b/.test(text)) {
    const today = startOfDay(now);
    if (/\bthis\s+week\b|\bnext\s+(?:few|seven|7)\s+days\b/.test(text)) return { kind: 'calendar', from: now, to: today + 7 * DAY, label: 'the next seven days' };
    if (/\bnext\s+(?:meeting|event|appointment)\b/.test(text)) return { kind: 'calendar', from: now, to: today + 14 * DAY, label: 'the next two weeks' };
    const when = findWhen(text, now);
    const day = when ? startOfDay(when.at) : today;
    const label = day === today ? 'today' : day === startOfDay(today + DAY + 2 * 60 * MINUTE) ? 'tomorrow' : new Date(day).toDateString();
    return { kind: 'calendar', from: day === today ? now : day, to: day + DAY, label };
  }
  if (/\b(?:my|any)\s+reminders\b|\bwhat\s+(?:do\s+i\s+(?:have|need)\s+to\s+do|is\s+on\s+my\s+(?:to-?do|list))\b|\bmy\s+to-?do\s+list\b/.test(text)) return { kind: 'reminders' };
  if (/\bwhere\s+am\s+i\b|\bmy\s+(?:current\s+)?location\b|\bwhat\s+(?:town|city|street|country)\s+am\s+i\s+in\b|\bnear\s+(?:me|here)\b/.test(text)) return { kind: 'location' };
  return null;
}

const two = (n: number) => String(n).padStart(2, '0');

/** "Tomorrow at 09:00", "Friday 20 November at 15:30", "Today at 18:05". */
export function sayWhen(at: number, now: number): string {
  const d = new Date(at);
  const days = Math.round((startOfDay(at) - startOfDay(now)) / DAY);
  const day =
    days === 0 ? 'Today' : days === 1 ? 'Tomorrow'
    : `${WEEKDAYS[d.getDay()][0].toUpperCase()}${WEEKDAYS[d.getDay()].slice(1)} ${d.getDate()} ${MONTHS[d.getMonth()][0].toUpperCase()}${MONTHS[d.getMonth()].slice(1)}` +
      (d.getFullYear() !== new Date(now).getFullYear() ? ` ${d.getFullYear()}` : '');
  return `${day} at ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** "25 minutes", "1 hour 30 minutes", "45 seconds". */
export function sayFor(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const left = minutes % 60;
  const h = hours ? `${hours} hour${hours === 1 ? '' : 's'}` : '';
  const m = left ? `${left} minute${left === 1 ? '' : 's'}` : '';
  return [h, m].filter(Boolean).join(' ');
}

/** The card for an action: what it is, and the details to check before approving. */
export function describeAction(action: Action, now: number): { title: string; detail: string; approve: string } {
  switch (action.kind) {
    case 'reminder':
      return { title: `Reminder: ${action.title}`, detail: action.at ? sayWhen(action.at, now) : 'No time set', approve: 'Add reminder' };
    case 'timer':
      return { title: action.title === 'Timer' ? 'Timer' : `Timer: ${action.title}`, detail: `${sayFor(action.at - now)}, until ${sayWhen(action.at, now).split(' at ')[1]}`, approve: 'Start timer' };
    case 'event':
      return { title: `Event: ${action.title}`, detail: `${sayWhen(action.at, now)}, for ${sayFor(action.minutes * MINUTE)}`, approve: 'Add to calendar' };
    case 'message':
      return { title: `Message to ${action.to}`, detail: action.body || 'Nothing written yet', approve: 'Open message' };
    case 'email':
      return { title: `Email to ${action.to}`, detail: action.subject || action.body || 'Nothing written yet', approve: 'Open email' };
    case 'call':
      return { title: `Call ${action.to}`, detail: 'Starts a phone call', approve: 'Call' };
    case 'directions':
      return { title: `Directions to ${action.to}`, detail: 'Opens in Maps', approve: 'Open Maps' };
  }
}
