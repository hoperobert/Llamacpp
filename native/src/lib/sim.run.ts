// Works the app by itself in a simulator test build, while screenshots are
// taken from outside once a second. It goes through what has gone wrong on a
// real iPhone and cannot be seen in a browser: the keyboard coming and going
// while a reply is written, stopping a reply, and leaving the app and coming
// back (idle, in the middle of a reply, and while a model loads).
//
// It runs with the real engine and a real small model ("real"), or with the
// stand-ins from the browser preview. Each step is added to a file with the
// time, so a screenshot can be matched to what was happening, and an app that
// closed shows up as a second "started". A line beginning LEAVE asks whatever
// is running the simulator to send the app to the background and bring it
// back. This file is never part of a normal build.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import { composerInput } from '../ui/Composer';
import { app, changeSettings, download, loadModel, newChat, runCommand, send, stop } from './app';
import { COMMANDS } from './commands';
import { engineVersion } from './engine';
import { MODELS } from './models';
import { DEFAULT_FLAGS, type SimFlags } from './simFlags';
import { createStore } from './store';

/** How the chat screen is built right now. The script changes it to try alternatives. */
const flags = createStore<SimFlags>(DEFAULT_FLAGS);
export const useSimFlags = (): SimFlags => flags.use((f) => f);

const REAL = engineVersion !== 'preview';
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (done: () => boolean, limit = 60000) => {
  for (let waited = 0; !done() && waited < limit; waited += 100) await wait(100);
  return done();
};

const file = new File(Paths.document, 'sim-steps.txt');
let written = '';
function step(name: string) {
  written += `${Date.now()} ${name}\n`;
  console.log(`[sim] ${name}`);
  try {
    if (!file.exists) file.create();
    file.write(written);
  } catch {
    // The steps are a convenience; the screenshots are what matter.
  }
}

const keyboard = (up: boolean) => (up ? composerInput.current?.focus() : composerInput.current?.blur());

/** What the app looks like inside, for the record. */
function state(): string {
  const s = app.get();
  const last = s.chat.messages.at(-1);
  return JSON.stringify({
    engine: s.engine.status, model: s.engine.modelId, gpu: s.engine.gpu, nCtx: s.settings.nCtx, busy: s.busy,
    messages: s.chat.messages.length, last: last ? `${last.role}:${last.content.length}` : null,
    stopped: last?.stopped, speed: last?.speed, title: s.chat.title, error: s.engine.error, lastError: s.lastError || undefined,
  });
}

/** Asks to be sent to the background and brought back, and waits for that to have happened. */
async function leave(label: string) {
  let left = false;
  let back = false;
  const watching = AppState.addEventListener('change', (next) => {
    if (next !== 'active') left = true;
    else if (left) back = true;
  });
  step(`LEAVE ${label}`);
  const returned = await until(() => back, 45000);
  watching.remove();
  await wait(1500);
  step(`${returned ? 'returned' : 'NEVER LEFT OR NEVER RETURNED'} (${label}) ${state()}`);
}

const command = (name: string, arg = '') => runCommand(COMMANDS.find((c) => c.name === name)!, arg);

/** Sends a message and waits for its reply to be finished. */
async function ask(text: string, limit = 120000) {
  const before = app.get().chat.messages.length;
  send(text);
  await until(() => app.get().busy || app.get().chat.messages.length > before + 1, 15000);
  await until(() => !app.get().busy, limit);
}

/**
 * Builds the chat screen in different ways, one after another, and does the
 * thing that turns the chat grey each time: a reply long enough to run under
 * the header while the keyboard is up. A line beginning DUMP asks for the
 * system's own list of what is on screen, which shows what the grey is.
 */
async function variants() {
  const tries: [string, Partial<SimFlags>][] = [
    ['as shipped', {}],
    ['no header at all', { header: false }],
    ['header not transparent', { transparentHeader: false }],
    ['list not upside down', { inverted: false }],
    ['no glass', { glass: false }],
    ['no jump button or toast', { overlays: false }],
    ['no message box', { composer: false }],
    ['list insets left alone', { plainInsets: true }],
    ['system edge effects hidden', { edges: 'hidden' }],
    ['no glass, no overlays, list not upside down', { glass: false, overlays: false, inverted: false }],
  ];
  for (const [name, change] of tries) {
    flags.set({ ...DEFAULT_FLAGS, ...change });
    newChat();
    await wait(1500);
    keyboard(true);
    await wait(1200);
    step(`TRY ${name}: keyboard up, empty`);
    await ask('Explain how vaccines work in simple terms');
    await wait(800);
    step(`TRY ${name}: reply done, keyboard up`);
    await wait(3500);
    keyboard(false);
    await wait(1800);
    step(`TRY ${name}: keyboard down`);
    await wait(1500);
  }
  flags.set(DEFAULT_FLAGS);
}

async function scenario() {
  await until(() => app.get().hydrated);
  step(`started with the ${REAL ? 'real engine' : 'stand-in engine'}. ${app.get().lastClose || 'first launch'}. ${state()}`);
  let seen = app.get().lastError;
  app.subscribe(() => {
    const now = app.get().lastError;
    if (now && now !== seen) { seen = now; step(`UNCAUGHT ERROR ${now.replace(/\s+/g, ' ').slice(0, 400)}`); }
  });
  await wait(2500);

  // ---------- a model ----------
  const model = MODELS.find((m) => m.id === (REAL ? 'qwen35-0.8b' : 'qwen35-4b'))!;
  if (!app.get().downloaded[model.id]) {
    download(model);
    step('downloading a model');
    // Background downloads do not work in a simulator build that is not signed, so do not wait long.
    await until(() => !!app.get().downloaded[model.id], REAL ? 25000 : 60000);
    step(`download ${app.get().downloaded[model.id] ? 'finished' : `DID NOT FINISH ${JSON.stringify(app.get().downloads[model.id])}`}`);
  }
  if (!app.get().downloaded[model.id]) {
    // Fall back to a copy put beside the app from outside, so the rest can still be tested.
    const spare = new File(Paths.document, `spare-${model.file}`);
    if (spare.exists) {
      await spare.move(new File(Paths.document, model.file));
      await AsyncStorage.setItem(`downloaded:${model.id}`, '1');
      app.set((s) => ({ downloaded: { ...s.downloaded, [model.id]: true } }));
      step('using the spare copy of the model');
    }
  }
  if (app.get().engine.status !== 'ready') {
    if (app.get().engine.status === 'none') loadModel(model);
    await until(() => app.get().engine.status === 'ready' || !!app.get().engine.error, 180000);
  }
  step(`model ${state()}`);
  await wait(2500);

  // ---------- the keyboard ----------
  keyboard(true);
  step('keyboard up, empty chat');
  await wait(3000);
  keyboard(false);
  step('keyboard down');
  await wait(2000);

  changeSettings({ thinking: true });
  const first = ask('Explain how vaccines work in simple terms');
  step('sent first message');
  await wait(1200);
  keyboard(true);
  step('keyboard up while thinking');
  await wait(4000);
  step('keyboard still up, reply being written');
  await first;
  step(`first reply done, keyboard up ${state()}`);
  await wait(2000);
  // The debugger stops the app while it looks, which can take a couple of minutes.
  step('DUMP first reply done, keyboard up');
  await wait(6000);
  step('dump over');
  await wait(2500);
  keyboard(false);
  step('keyboard down after first reply');
  await wait(2500);

  if (!REAL) {
    // With the stand-in there is no engine to test, only how the screen is built.
    await variants();
    step(`finished ${state()}`);
    return;
  }

  const second = ask('And how long do they last?');
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
  await second;
  step(`second reply done, keyboard up ${state()}`);
  await wait(2000);
  keyboard(false);
  await wait(1500);

  // ---------- stopping a reply ----------
  send('Write a long story about a lighthouse keeper, at least 400 words.');
  await until(() => app.get().busy, 15000);
  await wait(6000);
  stop();
  await until(() => !app.get().busy, 30000);
  step(`stopped a reply by hand ${state()}`);
  await wait(2000);

  // ---------- leaving the app and coming back ----------
  await leave('idle');
  send('Write a long poem about the sea, at least 300 words.');
  await until(() => app.get().busy, 15000);
  await wait(8000);
  await leave('in the middle of a reply');
  await until(() => !app.get().busy, 30000);
  step(`after leaving mid-reply ${state()}`);
  await ask('Continue');
  step(`continued ${state()}`);
  await wait(1500);

  // ---------- chats, commands ----------
  newChat();
  await wait(5000);
  step(`new chat. Earlier chats: ${JSON.stringify(app.get().chatList.slice(0, 3).map((c) => c.title))} ${state()}`);
  command('goal', 'Plan a weekend in Rome');
  command('context');
  await wait(1500);
  await ask('/plan a weekend in Rome');
  step(`planned ${state()}`);
  app.set({ draft: '/' });
  keyboard(true);
  step('command list open');
  await wait(2500);
  app.set({ draft: '' });
  keyboard(false);
  await wait(1500);

  // ---------- leaving while a model loads ----------
  loadModel(model);
  await wait(300);
  await leave('while a model is loading');
  await until(() => app.get().engine.status === 'ready' || !!app.get().engine.error, 180000);
  step(`after leaving during a load ${state()}`);
  await ask('Say hello in five words.');
  step(`replied after the reload ${state()}`);

  // ---------- the other screens ----------
  for (const [route, name] of [['/chats', 'side menu'], ['/models', 'models'], ['/library', 'library'], ['/options', 'reply options'], ['/settings', 'settings']] as const) {
    router.push(route);
    step(`${name} open`);
    await wait(2500);
    router.back();
    await wait(1200);
  }
  keyboard(false);
  await wait(1000);
  await variants();
  step(`finished ${state()}`);
}

export function runSim() {
  // Earlier launches stay in the file, so an app that closed shows as a second "started".
  try {
    written = file.exists ? file.textSync() : '';
  } catch {
    written = '';
  }
  // With the stand-in, replies last long enough to do things while they are being written.
  if (!REAL) (globalThis as { pocketPace?: number }).pocketPace = 2;
  if (written.includes(' finished ')) return;
  scenario().catch((error) => step(`SCRIPT ERROR ${String((error as Error)?.stack ?? error).slice(0, 400)}`));
}
