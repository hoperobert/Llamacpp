# Pocket LLM (native app)

The iPhone app version of Pocket LLM, built with Expo. It does what the web
version does (private chats, memories, context handling, settings) with three
things a browser cannot offer:

- **Background downloads.** Models keep downloading while the app is in the
  background, the phone is locked, or the app is closed.
- **More memory.** No browser tab limit, so loading does not crash the way it
  can in Safari or Chrome.
- **Bigger models.** No 2 GB file limit, so models up to Gemma 4 E4B and
  Qwen3.5 9B are offered alongside the small ones.

It runs llama.cpp natively on the GPU (Metal) through
[llama.rn](https://github.com/mybigday/llama.rn).

## What you need

- No Mac. Expo's cloud service (EAS Build) compiles the iPhone app.
- A free [Expo](https://expo.dev) account.
- An [Apple Developer](https://developer.apple.com/programs/) membership
  (USD 99 a year). Apple requires it to install any app you build on an iPhone.

## Build and install

No computer or terminal is needed. Everything happens in Safari on the iPhone.

1. Open [Expo Launch for this app](https://launch.dev/?github=https://github.com/hoperobert/Llamacpp/tree/claude/magical-darwin-7ddbmk/native&appBundleId=com.hoperobert.pocketllm&appName=Pocket+LLM&projectName=Pocket+LLM).
2. Sign in with Expo, choose **Launch to App Store**, and sign in to your
   Apple account when asked. Launch creates the signing certificates.
3. When the build finishes, Apple emails a TestFlight invite. Install the
   TestFlight app and open Pocket LLM from there.

Launch does not notice new commits. To ship an update, open the link again.

### If Launch does not work

Use a terminal in the browser instead. On GitHub, open the repository, tap
**Code → Codespaces → Create codespace**, then run:

```sh
./build-ios.sh
```

It asks you to sign in to Expo and Apple, sets up signing, builds in Expo's
cloud and sends the build to TestFlight.

## Status

The code type-checks and bundles, and the generated iOS project picks up the
background download hook and the increased-memory entitlements. It has not yet
been run on a device, so expect a round of fixes after the first build.

## Code map

| File | Purpose |
|---|---|
| `App.tsx` | The chat screen, chat list and app state. |
| `src/engine.ts` | Loading models and generating text through llama.rn. |
| `src/downloads.ts` | Background model downloads that survive the app closing. |
| `src/logic.ts` | Prompt building, context compaction and memories. |
| `src/storage.ts` | Chats, memories and settings saved on the device. |
| `src/ModelList.tsx` | The model picker with download controls. |
| `src/Settings.tsx` | The settings sheet. |
| `src/Markdown.tsx` | Markdown rendering for replies. |

## Checks

```sh
npm run typecheck
npx expo-doctor
```
