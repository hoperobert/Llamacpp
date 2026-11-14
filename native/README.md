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

From any computer with Node.js (Windows and Linux are fine):

```sh
cd native
npm install
npx eas-cli login
npx eas-cli build --platform ios --profile production --auto-submit
```

The first run asks you to sign in to your Apple account and sets up the
signing certificates for you. When it finishes, the build appears in
TestFlight; install the TestFlight app on the iPhone and open it from there.

Expo can also build straight from GitHub with no computer at all: connect this
repository in the project's settings on expo.dev and set the base directory to
`native`. Apple credentials are then added on expo.dev using an App Store
Connect API key.

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
