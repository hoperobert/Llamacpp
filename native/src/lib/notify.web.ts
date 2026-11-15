// The browser preview has no notifications. What would have been shown is kept, for checks.

export const shown: { title: string; body: string; chatId?: string }[] = [];
(globalThis as { pocketNotified?: typeof shown }).pocketNotified = shown;

export function setUpNotifications(_onOpen: (chatId: string) => void) {}
export async function askToNotify() {}
export function notify(title: string, body: string, chatId?: string) { shown.push({ title, body, chatId }); }
export function clearNotifications() {}
