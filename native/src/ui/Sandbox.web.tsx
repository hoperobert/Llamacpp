// The browser preview's stand-in for the web view: a frame that may run
// scripts and nothing else.

import React, { useEffect, useRef } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import type { Line } from '../lib/runner';

export function Sandbox({ html, address, code, onLine, onAsk, style }: {
  html?: string;
  address?: string;
  code?: string;
  onLine: (line: Line) => void;
  onAsk?: (what: string, arg: unknown) => Promise<unknown>;
  style?: StyleProp<ViewStyle>;
}) {
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const hear = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      try {
        const line = JSON.parse(event.data);
        if (!line || typeof line.kind !== 'string') return;
        if (line.kind === 'ready' && code !== undefined) {
          frame.current?.contentWindow?.postMessage(JSON.stringify({ run: code }), '*');
        }
        if (line.kind === 'ask') {
          const { id, what, arg } = JSON.parse(String(line.text));
          Promise.resolve(onAsk ? onAsk(String(what), arg) : null).catch(() => null).then((value) => {
            frame.current?.contentWindow?.postMessage(JSON.stringify({ answer: { id, value: value ?? null } }), '*');
          });
          return;
        }
        onLine({ kind: line.kind, text: String(line.text ?? '') });
      } catch {
        // Not one of ours.
      }
    };
    window.addEventListener('message', hear);
    return () => window.removeEventListener('message', hear);
  }, [onLine, onAsk, code]);

  const flat = StyleSheet.flatten(style) ?? {};
  return (
    <iframe
      ref={frame}
      sandbox={address ? 'allow-scripts allow-same-origin' : 'allow-scripts'}
      {...(address ? { src: address } : { srcDoc: html })}
      title="Running code"
      style={{ border: 0, width: '100%', ...(flat as React.CSSProperties) }}
    />
  );
}
