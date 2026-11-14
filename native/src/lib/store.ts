// A very small state container. Screens subscribe to just the fields they
// show, so a reply streaming in does not repaint the whole app.

import { useSyncExternalStore } from 'react';

export function createStore<T extends object>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();

  const get = () => state;

  const set = (patch: Partial<T> | ((current: T) => Partial<T>)) => {
    const next = typeof patch === 'function' ? patch(state) : patch;
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };

  /** Pick one field (or a value derived from one) with a selector that returns a stable reference. */
  function use<S>(selector: (current: T) => S): S {
    return useSyncExternalStore(subscribe, () => selector(state), () => selector(state));
  }

  return { get, set, subscribe, use };
}
