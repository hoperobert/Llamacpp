// For an update sent to a build of the app made before it had a web view to
// run code in. Nothing is shown; the Run button is not offered there.

import type { StyleProp, ViewStyle } from 'react-native';
import type { Line } from '../lib/runner';

export function Sandbox(_props: {
  html?: string;
  address?: string;
  code?: string;
  onLine: (line: Line) => void;
  onAsk?: (what: string, arg: unknown) => Promise<unknown>;
  style?: StyleProp<ViewStyle>;
}) {
  return null;
}
