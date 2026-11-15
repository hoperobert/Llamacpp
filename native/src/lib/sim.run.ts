// Works the app by itself in a simulator test build, while screenshots are
// taken from outside once a second. It goes through the moments that have gone
// wrong on a real iPhone and cannot be seen in a browser: the keyboard coming
// up while a reply is written, and coming and going repeatedly.
//
// Each step is written to a file with the time, so a screenshot can be matched
// to what was happening. This file is never part of a normal build.

import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import { composerInput } from '../ui/Composer';
import { app, changeSettings, download, send } from './app';
import { MODELS } from './models';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (done: () => boolean, limit = 60000) => {
  for (let waited = 0; !done() && waited < limit; waited += 100) await wait(100);
};

const lines: string[] = [];
function step(name: string) {
  lines.push(`${Date.now()} ${name}`);
  console.log(`[sim] ${name}`);
  try {
    const file = new File(Paths.document, 'sim-steps.txt');
    if (!file.exists) file.create();
    file.write(`${lines.join('\n')}\n`);
  } catch {
    // The steps are a convenience; the screenshots are what matter.
  }
}

const keyboard = (up: boolean) => (up ? composerInput.current?.focus() : composerInput.current?.blur());

export async function runSim() {
  // Replies last long enough to do things while they are being written.
  (globalThis as { pocketPace?: number }).pocketPace = 4;
  await until(() => app.get().hydrated);
  step('started');
  await wait(2500);

  const model = MODELS.find((m) => m.id === 'qwen35-4b')!;
  download(model);
  step('downloading a model');
  await until(() => app.get().engine.status === 'ready');
  step('model ready');
  await wait(2500);

  keyboard(true);
  step('keyboard up, empty chat');
  await wait(3000);
  keyboard(false);
  step('keyboard down');
  await wait(2000);

  changeSettings({ thinking: true });
  send('Explain how vaccines work in simple terms');
  step('sent first message');
  await wait(1200);
  keyboard(true);
  step('keyboard up while thinking');
  await wait(4000);
  step('keyboard still up, reply being written');
  await until(() => !app.get().busy);
  step('first reply done, keyboard up');
  await wait(2500);
  keyboard(false);
  step('keyboard down after first reply');
  await wait(2500);

  send('And how long do they last?');
  step('sent second message');
  for (let i = 1; i <= 3; i++) {
    await wait(900);
    keyboard(true);
    step(`keyboard up, round ${i}`);
    await wait(1500);
    keyboard(false);
    step(`keyboard down, round ${i}`);
  }
  await wait(900);
  keyboard(true);
  step('keyboard up for the rest of the second reply');
  await until(() => !app.get().busy);
  step('second reply done, keyboard up');
  await wait(2500);

  app.set({ draft: '/' });
  step('command list open');
  await wait(2500);
  app.set({ draft: '' });
  keyboard(false);
  step('keyboard down, command list closed');
  await wait(2000);

  for (const [route, name] of [['/chats', 'side menu'], ['/models', 'models'], ['/library', 'library'], ['/options', 'reply options'], ['/settings', 'settings']] as const) {
    router.push(route);
    step(`${name} open`);
    await wait(2500);
    router.back();
    await wait(1200);
  }
  step('finished');
}
