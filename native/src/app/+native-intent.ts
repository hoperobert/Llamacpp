// A file opened in Pocket LLM from another app (Files, Mail, the share sheet)
// arrives as its address. It is not a screen to go to: the file is read and
// held to go with the next message, and the chat is shown.

import { attachFile } from '../lib/app';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (path.startsWith('file:')) {
    attachFile(path);
    return '/';
  }
  return path;
}
