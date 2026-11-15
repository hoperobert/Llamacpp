// Ways the chat screen can be built, so that a simulator test can try them
// side by side when hunting something only iOS shows. A normal build always
// uses the defaults. See sim/README.md.

export type SimFlags = {
  /** The system's dimming of a list where it runs under a bar. */
  edges: 'default' | 'hidden';
  /** Whether the chat runs under the header. */
  transparentHeader: boolean;
  /** Whether the message list is drawn upside down, so that it grows from the bottom. */
  inverted: boolean;
  /** Whether the message box and the button for jumping to the latest message are glass. */
  glass: boolean;
};

export const DEFAULT_FLAGS: SimFlags = { edges: 'default', transparentHeader: true, inverted: true, glass: true };
