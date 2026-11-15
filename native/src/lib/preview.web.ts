// In the browser preview only, the app's state and actions are reachable from
// the console (and from scripted checks) as `pocket`. This file is never part
// of the iPhone app.

import { moveKeyboardInset } from '../ui/keyboard';
import * as actions from './app';

// `pocket.keyboard(300)` makes room as if a keyboard that tall had appeared.
const preview = { ...actions, keyboard: moveKeyboardInset };
(globalThis as { pocket?: typeof preview }).pocket = preview;

export {};
