// In a normal build this does nothing. A simulator test build swaps in
// sim.run.ts instead (see metro.config.js), which works the app by itself.

import { DEFAULT_FLAGS, type SimFlags } from './simFlags';

export const useSimFlags = (): SimFlags => DEFAULT_FLAGS;

export function runSim() {}
