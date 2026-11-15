// SF Symbols on iOS. Elsewhere, the closest Material symbol.

import React from 'react';
import type { ColorValue, StyleProp, ViewStyle } from 'react-native';
import { SymbolView, type SymbolWeight } from 'expo-symbols';

const SYMBOLS = {
  'arrow.up': 'arrow_upward',
  'stop.fill': 'stop',
  'arrow.down': 'arrow_downward',
  'arrow.down.circle': 'download',
  'arrow.clockwise': 'refresh',
  'doc.on.doc': 'content_copy',
  'square.and.arrow.up': 'ios_share',
  'speaker.wave.2': 'volume_up',
  'stop.circle': 'stop_circle',
  'pencil': 'edit',
  'trash': 'delete',
  'checkmark': 'check',
  'checkmark.circle.fill': 'check_circle',
  'exclamationmark.triangle.fill': 'warning',
  'xmark.circle.fill': 'cancel',
  'chevron.right': 'chevron_right',
  'chevron.down': 'expand_more',
  'chevron.up': 'expand_less',
  'pause.fill': 'pause',
  'play.fill': 'play_arrow',
  'ellipsis': 'more_horiz',
  'pin.fill': 'keep',
  'plus': 'add',
  'sparkles': 'auto_awesome',
  'lightbulb': 'lightbulb',
  'lightbulb.fill': 'lightbulb',
  'lock.fill': 'lock',
  'wifi.slash': 'wifi_off',
  'bolt.fill': 'bolt',
  'cpu': 'memory',
  'text.bubble': 'chat',
  'brain': 'psychology',
  'link': 'link',
  'internaldrive': 'hard_drive',
  'envelope': 'mail',
  'list.bullet.clipboard': 'assignment',
  'graduationcap': 'school',
  'fork.knife': 'restaurant',
  'chevron.left.forwardslash.chevron.right': 'code',
  'globe': 'language',
  'magnifyingglass': 'search',
  'gearshape': 'settings',
  'plus.circle.fill': 'add_circle',
  'eye.slash': 'visibility_off',
  'books.vertical': 'library_books',
  'doc.text': 'description',
  'xmark': 'close',
  'photo': 'image',
  'camera': 'photo_camera',
  'line.3.horizontal': 'menu',
  'folder': 'folder',
  'folder.badge.plus': 'create_new_folder',
  'mic': 'mic',
  'bookmark': 'bookmark',
  'wrench.and.screwdriver': 'build',
  'cross.case': 'medical_services',
  'flashlight.on.fill': 'flashlight_on',
  'flashlight.off.fill': 'flashlight_off',
  'location': 'my_location',
  'speaker.wave.3': 'campaign',
  'sun.max': 'light_mode',
  'safari': 'explore',
  'battery.75percent': 'battery_5_bar',
  'airplane': 'flight',
  'bolt.heart': 'emergency',
  'waveform': 'graphic_eq',
  'bell': 'notifications',
  'timer': 'timer',
  'calendar': 'calendar_today',
  'message': 'sms',
  'phone': 'call',
  'map': 'map',
} as const;

export type IconName = keyof typeof SYMBOLS;

export function Icon({ name, size = 20, color, weight = 'medium', style }: {
  name: IconName;
  size?: number;
  color: ColorValue;
  weight?: SymbolWeight;
  style?: StyleProp<ViewStyle>;
}) {
  const fallback = SYMBOLS[name];
  return (
    <SymbolView
      name={{ ios: name, android: fallback, web: fallback }}
      size={size}
      tintColor={color}
      weight={weight}
      style={[{ width: size, height: size }, style]}
    />
  );
}
