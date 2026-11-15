// For an update sent to a build of the app made before it could show notifications.

export function setUpNotifications(_onOpen: (chatId: string) => void) {}
export async function askToNotify() {}
export function neverAskToNotify() {}
export function notify(_title: string, _body: string, _chatId?: string) {}
export function clearNotifications() {}
