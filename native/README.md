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
- **Downloads** arrive in 64 MB pieces that are saved as they finish, so a lost
  connection, a pause, closing the app or an app update never costs more than
  the piece in flight. They carry on in the background, pick up by themselves
  when the connection returns, and show speed and time remaining.
- **Thinking**, a reply **style** (Normal, Concise, Explain, Formal) and reply
  length are set from the "+" in the message box.
- **Photos** can be sent to models that can look at them (Qwen3.5 2B and 4B,
  Gemma 4 E2B) after a one-off add-on download for that model.
- **Look up** answers from an offline library instead of the web. The
  passages that fit a question are found on the phone and handed to the model
  with it; their titles show under your message. The library holds text files
  of your own and any of these downloads:

  | Source | Holds | Download | On the phone |
  |---|---|---|---|
  | Wikipedia | Simple English, 242,000 articles | 157 MB | 500 MB |
  | Wikipedia in depth | The 50,000 most important English articles, in full | 674 MB | 2.1 GB |
  | Medicine | 6,800 medical articles | 33 MB | 100 MB |
  | Dictionary | 112,000 definitions | 9 MB | 30 MB |
  | How-to guides | 180,000 wikiHow guides | 287 MB | 900 MB |

  Another source is one entry in `src/lib/sources.ts`: a Parquet file with a
  column of titles and a column of text.
- **Projects** group chats that share instructions.
- **Incognito chats** are never saved, named or used for memories.
- **Any message** you sent can be taken back and changed.
- **Memories** and **custom instructions** carry across chats.
- **Storage** is a SQLite database on the device, so searching chats does not
  mean reading them all into memory.
- **Replies** can be copied, shared, read aloud or asked for again. A message
  typed while one is being written is queued and sent when it finishes.

It uses the system's own navigation bars, sheets, menus and SF Symbols, and
Liquid Glass for the message box on iOS 26 and later. The look is warm and
quiet: a paper-like palette with a blue accent.

## Being a good citizen on the phone

- iOS closes an app that uses the GPU in the background. A reply is stopped
  cleanly as the app leaves the screen and what was written is kept; nothing
  is asked of the model until the app is back. A message sent just as the app
  was left gets its reply on return.
- The bottom of Settings says how the app last closed (on screen or in the
  background, and what it was doing), which tells a crash from iOS making room.
- The model stays loaded while the app is in the background, so coming back
  is instant. If iOS closes the app to make room for others, opening it again
  within half an hour returns to the chat that was open.
- Naming a chat and picking out memories also use the model. In a long chat
  they wait until the chat is left, so the next reply does not have to re-read
  the whole conversation.

## Preview in a browser

```sh
npx expo start --web
```

This shows the interface with a stand-in model and pretend downloads
(the `.web.ts` files in `src/lib`). It is for checking
layout; system bars, menus and Liquid Glass only appear on an iPhone.

In the preview the app's state and actions are available in the browser
console as `pocket` (for example `pocket.app.get()`), which is how scripted
checks drive it.

## Engine patch

Nemotron Dory uses a model format that llama.cpp has not released support for
yet. `patches/llama.rn+0.13.0-rc.11.patch` adds it (ported from llama.cpp pull
request 30306) and is applied on every `npm install`. Because of the patch,
`eas.json` sets `RNLLAMA_BUILD_FROM_SOURCE=1` so the engine is compiled during
the build instead of using the prebuilt one.

The same patch turns off Metal residency sets on iOS. With them, the whole
model stays wired in memory for three minutes after it was last used, which on
a phone outlasts the app leaving the screen: iOS then closes the app rather
than page out a 3 GB model. Without them the model is ordinary file-backed
memory.

When llama.rn ships Dory support itself, drop the Dory part of the patch. The
`postinstall` script and the build-from-source setting stay for as long as any
patch does.

## Code map

| Path | Purpose |
|---|---|
| `src/app/` | The screens: chat (`index`), side menu, reply options, models, library, projects, settings. |
| `src/lib/app.ts` | The app's state and everything it can do. |
| `src/lib/engine.ts` | Loading models and generating text through llama.rn. |
| `src/lib/downloads.ts` | Background model downloads that survive the app closing. |
| `src/lib/logic.ts` | Prompt building, context compaction, titles and memories. |
| `src/lib/models.ts` | The model catalogue and how well each suits a device. |
| `src/lib/db.ts` | The SQLite database: chats, messages, projects and memories. |
| `src/lib/sources.ts` | What can be downloaded into the offline library. |
| `src/lib/library.ts` | The offline library: indexing those downloads and your files. |
| `src/lib/retrieval.ts` | Choosing the passages that fit a question. |
| `src/lib/images.ts` | Photos attached to messages. |
| `src/lib/storage.ts` | Settings and other small preferences. |
| `src/ui/` | Shared pieces: messages, the message box, lists, Markdown, icons. |

## Checks

```sh
npm run typecheck
npm test
npx expo lint
npx expo-doctor
```

`npm test` runs the app's real database and download code under Node, with
stand-ins for the phone-only modules (`tests/mocks`). It covers the one-time
import of older chats and memories, search, projects, and a download whose
connection drops, whose app is closed or updated part-way, or that is
interrupted while its pieces are being joined. It also builds a small library
index, closes the app half-way through, and checks what is looked up.
