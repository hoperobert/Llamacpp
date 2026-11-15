// Emergency mode: what it changes about how replies are written.
//
// Nothing here touches the phone, so the tests use it as it is.

import type { Settings } from './storage';

/**
 * The settings as they apply right now. In emergency mode replies are short,
 * written without thinking first, and checked against whatever library is on
 * the phone, whatever the usual settings say.
 */
export function inForce(settings: Settings): Settings {
  if (!settings.emergency) return settings;
  return {
    ...settings, style: 'concise', thinking: false, lookup: true,
    maxTokens: Math.min(settings.maxTokens, 400), temperature: Math.min(settings.temperature, 0.4),
  };
}

/** What the model is told in emergency mode. */
export const EMERGENCY =
  'The user may be in an emergency, with no internet and no one to ask. Give the most important action first, ' +
  'then short numbered steps a frightened person can follow. Say when to call emergency services. ' +
  'If you are not sure, say so plainly and give the safest course. No preamble.';
