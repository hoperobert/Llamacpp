// The closed room code is run in: a web view showing one page, with no way out
// of it. It cannot open another address, and what it says comes back as lines.

import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import type { Line } from '../lib/runner';

export function Sandbox({ html, onLine, style }: {
  html: string;
  onLine: (line: Line) => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <WebView
      source={{ html, baseUrl: 'about:blank' }}
      originWhitelist={['*']}
      style={style}
      incognito
      javaScriptCanOpenWindowsAutomatically={false}
      allowFileAccess={false}
      allowsLinkPreview={false}
      dataDetectorTypes="none"
      // The page it was given, and nowhere else.
      onShouldStartLoadWithRequest={(request) => request.url.startsWith('about:')}
      onMessage={(event) => {
        try {
          const line = JSON.parse(event.nativeEvent.data);
          if (line && typeof line.kind === 'string') onLine({ kind: line.kind, text: String(line.text ?? '') });
        } catch {
          // Not one of ours.
        }
      }}
      // The page ran out of memory or was stopped by iOS.
      onContentProcessDidTerminate={() => onLine({ kind: 'error', text: 'Stopped: the code used too much memory.' })}
    />
  );
}
