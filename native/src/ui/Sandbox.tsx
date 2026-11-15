// The closed room code is run in: a web view showing one page, with no way out
// of it. It cannot open another address, and what it says comes back as lines.
//
// The page is either written out in full (`html`), or loaded from the app's
// own folder of files on this phone (`address`), which is how Python runs.
// A page that says it is ready is handed `code` to run.

import React, { useRef } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import type { Line } from '../lib/runner';

export function Sandbox({ html, address, code, onLine, onAsk, style }: {
  html?: string;
  address?: string;
  code?: string;
  onLine: (line: Line) => void;
  /** Answers the page when it asks the phone for something (`pocket.phone`). */
  onAsk?: (what: string, arg: unknown) => Promise<unknown>;
  style?: StyleProp<ViewStyle>;
}) {
  const view = useRef<WebView<object>>(null);
  return (
    <WebView<object>
      ref={view}
      source={address ? { uri: address } : { html: html ?? '', baseUrl: 'about:blank' }}
      originWhitelist={['*']}
      style={style}
      incognito
      javaScriptCanOpenWindowsAutomatically={false}
      allowFileAccess={false}
      allowsLinkPreview={false}
      dataDetectorTypes="none"
      // The page it was given, and nowhere else.
      onShouldStartLoadWithRequest={(request) =>
        request.url.startsWith('about:') || (!!address && request.url.startsWith(address))}
      onMessage={(event) => {
        try {
          const line = JSON.parse(event.nativeEvent.data);
          if (!line || typeof line.kind !== 'string') return;
          if (line.kind === 'ready' && code !== undefined) {
            view.current?.injectJavaScript(`window.pocketRun(${JSON.stringify(code)}); true;`);
          }
          if (line.kind === 'ask') {
            const { id, what, arg } = JSON.parse(String(line.text));
            Promise.resolve(onAsk ? onAsk(String(what), arg) : null).catch(() => null).then((value) => {
              view.current?.injectJavaScript(`window.pocket.answer(${Number(id)}, ${JSON.stringify(value ?? null)}); true;`);
            });
            return;
          }
          onLine({ kind: line.kind, text: String(line.text ?? '') });
        } catch {
          // Not one of ours.
        }
      }}
      onError={() => onLine({ kind: 'error', text: 'The page could not be opened.' })}
      // The page ran out of memory or was stopped by iOS.
      onContentProcessDidTerminate={() => onLine({ kind: 'error', text: 'Stopped: the code used too much memory.' })}
    />
  );
}
