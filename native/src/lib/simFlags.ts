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
  /** Whether the screen has the system's header at all. */
  header: boolean;
  /** Whether the pieces that float over the chat (jump button, toast) are there. */
  overlays: boolean;
  /** Whether the message box is there. */
  composer: boolean;
  /** Whether the list is told to leave its own insets alone. */
  plainInsets: boolean;
};

export const DEFAULT_FLAGS: SimFlags = {
  edges: 'default', transparentHeader: true, inverted: true, glass: true,
  header: true, overlays: true, composer: true, plainInsets: false,
};
