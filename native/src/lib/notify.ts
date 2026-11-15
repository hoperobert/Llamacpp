// Notifications from the phone itself: a reply that finished while the app
// was away, or one that needs the app opened to carry on. Nothing is sent
// from anywhere else; there is no server.

import * as Notifications from 'expo-notifications';

let ready = false;
let asked = false;

/** Call once at launch. `onOpen` is given the chat a tapped notification is about. */
export function setUpNotifications(onOpen: (chatId: string) => void) {
  if (ready) return;
  ready = true;
  try {
    // Nothing is shown on top of the app while it is open: what it would say is already on the screen.
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false,
      }),
    });
    Notifications.addNotificationResponseReceivedListener((response) => {
      const chatId = response.notification.request.content.data?.chatId;
      if (typeof chatId === 'string') onOpen(chatId);
    });
  } catch {
    // An older build without notifications in it.
  }
}

/** Asks, once, whether notifications may be shown. Does nothing after that. */
export async function askToNotify() {
  if (asked) return;
  asked = true;
  try {
    const now = await Notifications.getPermissionsAsync();
    if (!now.granted && now.canAskAgain) {
      await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
    }
  } catch {
    // No notifications here.
  }
}

/** Shows a notification now. Quietly does nothing if they are not allowed. */
export function notify(title: string, body: string, chatId?: string) {
  Notifications.scheduleNotificationAsync({
    content: { title, body, sound: true, data: chatId ? { chatId } : {} },
    trigger: null,
  }).catch(() => {});
}

/** Clears what is in Notification Centre, once the app is open and it has all been seen. */
export function clearNotifications() {
  Notifications.dismissAllNotificationsAsync().catch(() => {});
}
