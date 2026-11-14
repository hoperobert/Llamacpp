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

The app is already set up on Expo and in App Store Connect, so a new build is
one command from the `native` folder. No Mac is needed, and a GitHub
Codespace works as the terminal.

```sh
npx eas-cli@latest build --platform ios --profile production --auto-submit
```

Expo compiles the app in its cloud and sends it to TestFlight. Apple takes a
few minutes to process it, then it appears in the TestFlight app.

Signing in is either `npx eas-cli@latest login`, or an Expo access token in
the `EXPO_TOKEN` environment variable.

### Setting it up from scratch

For a different Expo or Apple account, remove `owner` and `extra.eas` from
`app.json` and `ascAppId` from `eas.json`, then either:

- open [Expo Launch](https://launch.dev) in a browser and give it this
  repository, which does the whole first build with no terminal; or
- run `./build-ios.sh` in a terminal, which signs you in to Expo and Apple and
  creates the signing certificates.

## What it does

- **Chats** stream in with Markdown, tables and code blocks, are named
  automatically, and can be searched, pinned, renamed and shared from the
  side menu.
- **Models** are grouped by speed, and can be added from a link to any GGUF
  file. Ones too big for the iPhone are not offered.
- **Downloads** carry on in the background, show speed and time remaining,
  restart themselves after an app update, and ask before using mobile data.
- **Thinking** can be switched on from the message box, and the reasoning is
  folded away under the reply.
- **Memories** (stored in SQLite) and **custom instructions** carry across
  chats.
- **Replies** can be copied, shared, read aloud or asked for again.

It uses the system's own navigation bars, sheets, menus and SF Symbols, and
Liquid Glass for the message box on iOS 26 and later. The look is warm and
quiet: a paper-like palette, one accent colour, and replies set in a serif.

## Being a good citizen on the phone

- A reply is stopped cleanly when the app goes to the background, because iOS
  does not allow GPU work there. What was written is kept.
- If iOS asks for memory back while the app is in the background, the model is
  let go and loaded again on return, so the app itself is not closed.
- Naming a chat and picking out memories also use the model. In a long chat
  they wait until the chat is left, so the next reply does not have to re-read
  the whole conversation.

## Preview in a browser

```sh
npx expo start --web
```

This shows the interface with a stand-in model and pretend downloads
(`src/lib/engine.web.ts`, `src/lib/downloads.web.ts`). It is for checking
layout; system bars, menus and Liquid Glass only appear on an iPhone.

## Dory support

Nemotron Dory uses a model format that llama.cpp has not released support for
yet. `patches/llama.rn+0.13.0-rc.11.patch` adds it (ported from llama.cpp pull
request 30306) and is applied on every `npm install`. Because of the patch,
`eas.json` sets `RNLLAMA_BUILD_FROM_SOURCE=1` so the engine is compiled during
the build instead of using the prebuilt one.

When llama.rn ships Dory support itself, delete the patch, the `postinstall`
script and that setting.

## Code map

| Path | Purpose |
|---|---|
| `src/app/` | The screens: chat (`index`), chat list, model library, settings. |
| `src/lib/app.ts` | The app's state and everything it can do. |
| `src/lib/engine.ts` | Loading models and generating text through llama.rn. |
| `src/lib/downloads.ts` | Background model downloads that survive the app closing. |
| `src/lib/logic.ts` | Prompt building, context compaction, titles and memories. |
| `src/lib/models.ts` | The model catalogue and how well each suits a device. |
| `src/lib/storage.ts` | Chats and settings saved on the device. |
| `src/lib/memories.ts` | Memories, kept in a SQLite database. |
| `src/ui/` | Shared pieces: messages, the message box, lists, Markdown, icons. |

## Checks

```sh
npm run typecheck
npx expo lint
npx expo-doctor
```
