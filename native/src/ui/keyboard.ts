// The room the keyboard takes at the bottom of the screen, as a value that
// moves with it.
//
// React Native's own KeyboardAvoidingView makes room by animating the whole
// layout. If the screen is also being redrawn at that moment (a reply being
// written), views can be left at the wrong size: a strip of the fade behind
// the header ended up stretched over the chat. Here only one number is
// animated, and the layout simply follows it.

import { useEffect } from 'react';
import { Animated, Dimensions, Easing, Keyboard, Platform, type KeyboardEvent } from 'react-native';

/** The curve the iOS keyboard moves with, near enough. */
const KEYBOARD_CURVE = Easing.bezier(0.38, 0.7, 0.125, 1);

/** One value for the app: there is only one keyboard. */
const inset = new Animated.Value(0);

/** Moves the room made for the keyboard to a height, over the time the keyboard takes. */
export function moveKeyboardInset(height: number, duration = 250) {
  Animated.timing(inset, {
    toValue: Math.max(0, height),
    duration: Math.max(0, Math.min(duration, 500)),
    easing: KEYBOARD_CURVE,
    // Padding is layout, which the native driver cannot animate.
    useNativeDriver: false,
  }).start();
}

export function useKeyboardInset(): Animated.Value {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    // Measured from where the keyboard's top edge ends up, so it is right for
    // any keyboard: split, floating, or with a hardware keyboard attached.
    const follow = (event: KeyboardEvent) =>
      moveKeyboardInset(Dimensions.get('window').height - event.endCoordinates.screenY, event.duration);
    const hide = (event: KeyboardEvent) => moveKeyboardInset(0, event?.duration);
    const subscriptions = Platform.OS === 'ios'
      ? [Keyboard.addListener('keyboardWillChangeFrame', follow), Keyboard.addListener('keyboardWillHide', hide)]
      : [Keyboard.addListener('keyboardDidShow', follow), Keyboard.addListener('keyboardDidHide', hide)];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, []);
  return inset;
}
