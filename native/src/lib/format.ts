// Turning numbers into words people read.

export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return 'under a minute left';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min left`;
}

export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond <= 0) return '';
  const mb = bytesPerSecond / 1e6;
  return mb >= 1 ? `${mb.toFixed(mb >= 10 ? 0 : 1)} MB/s` : `${Math.round(bytesPerSecond / 1e3)} KB/s`;
}

const DAY = 86400000;
const startOfDay = (time: number) => new Date(time).setHours(0, 0, 0, 0);

/** Which heading a chat belongs under in the list of chats. */
export function dayGroup(time: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(time)) / DAY);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Previous 7 Days';
  if (days < 30) return 'Previous 30 Days';
  return 'Earlier';
}

export function shortTime(time: number, now = Date.now()): string {
  const date = new Date(time);
  const days = Math.round((startOfDay(now) - startOfDay(time)) / DAY);
  if (days <= 0) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (days < 7) return date.toLocaleDateString([], { weekday: 'short' });
  return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
}
