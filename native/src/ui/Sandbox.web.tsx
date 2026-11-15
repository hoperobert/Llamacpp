// The browser preview's stand-in for the web view: a frame that may run
// scripts and nothing else.

import React, { useEffect, useRef } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import type { Line } from '../lib/runner';

export function Sandbox({ html, onLine, style }: {
  html: string;
  onLine: (line: Line) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const hear = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      try {
        const line = JSON.parse(event.data);
        if (line && typeof line.kind === 'string') onLine({ kind: line.kind, text: String(line.text ?? '') });
      } catch {
        // Not one of ours.
      }
    };
    window.addEventListener('message', hear);
    return () => window.removeEventListener('message', hear);
  }, [onLine]);

  const flat = StyleSheet.flatten(style) ?? {};
  return (
    <iframe
      ref={frame}
      sandbox="allow-scripts"
      srcDoc={html}
      title="Running code"
      style={{ border: 0, width: '100%', ...(flat as React.CSSProperties) }}
    />
  );
}
