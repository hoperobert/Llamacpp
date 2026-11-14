// In the browser preview only, the app's state and actions are reachable from
// the console (and from scripted checks) as `pocket`. This file is never part
// of the iPhone app.

import * as actions from './app';

(globalThis as { pocket?: typeof actions }).pocket = actions;

export {};
