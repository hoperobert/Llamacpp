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

### Building on GitHub instead

Expo's free plan allows a set number of iOS builds a month. The same build can
be made on GitHub's Mac, which is free for a public repository and has no such
limit: change `testflight/build` and push, and GitHub builds the app and sends
it to TestFlight. It needs an Expo access token saved as a repository secret
named `EXPO_TOKEN`. See `testflight/README.md`.

### Fixes without a build

A change that is only code does not need a new build. Publishing it makes it
arrive the next time the app is opened:

```sh
npx eas-cli@latest update --channel production --message "What changed"
```

A build only takes updates with the same `runtimeVersion` (`app.json`).
Anything that adds or changes a native package needs a build, and the runtime
version raised first, so the update that follows cannot reach an older build.
`npm test` fails if the packages, patches or app configuration have changed
without that; after raising it, run `npm run runtime:lock`. The bottom of Settings
shows the build number and, when one is in use, the update.

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
- **Thinking** stays out of the way: one line says the model is thinking, or
  for how long it thought, and tapping it shows the reasoning.
- Whether to think first, a reply **style** (Normal, Concise, Explain, Formal) and reply
  length are set from the "+" in the message box.
- **Slash commands**: typing `/` in the message box lists them. Some are
  requests to the model (`/plan`, `/summarise`, `/explain`, `/rewrite`,
  `/shorter`, `/longer`, `/translate`, `/brainstorm`, `/review`, `/fix`).
  The rest act on the app: `/new`, `/incognito`, `/model`, `/think`,
  `/lookup`, `/style`, `/length`, `/compact`, `/context`, `/retry`, `/rename`,
  `/pin`, `/share`, `/delete`, `/remember`, `/memory`, `/chats`, `/projects`,
  `/library`, `/settings`. `/goal` sets what a chat is for, and the model is
  reminded of it in every reply until it is cleared.
- **Photos** from the library or the camera can be sent to models that can
  look at them (Qwen3.5 2B and 4B, Qwen3.5 4B Unfiltered, Gemma 4 E2B and
  E4B), marked with a picture in the model list. What such a model
  needs for it is downloaded along with the model.
- **Look up** answers from an offline library instead of the web. When a
  question is about something the library has, the passages that fit are found
  on the phone and handed to the model with it, each headed by its source and
  title; their titles show under your message. Remarks and requests ("make
  that shorter") are not looked up, and nothing is handed over twice. The library holds text files
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
- **It does things on the phone.** "Remind me to call the dentist tomorrow at
  9", "set a timer for 10 minutes", "add dinner with Ana to my calendar on
  Friday at 7pm", "text Mum I'm running late", "call Sam", "directions to
  Kings Cross": each is offered as a card saying exactly what will happen, and
  nothing happens until it is approved. Reminders, Calendar, Messages, Mail,
  Phone and Maps do the work, and iOS asks for each permission the first time
  it is needed. Questions about the phone ("what's on my calendar today?",
  "what are my reminders?", "where am I?") are answered from the phone. What
  was asked for, and when, is worked out by rule (`src/lib/assistant.ts`), not
  by the model: a small model gets dates wrong, and rules cost no time.
- **Voice.** With nothing typed, the send button is a microphone: it listens
  until you pause, sends what you said, and reads the reply aloud. The words
  are worked out on the iPhone where it can do that.
- **Files and photos of text.** A PDF or a text file can be attached to a
  message, or opened in Pocket LLM from Files, Mail or the share sheet; as
  much of it as fits goes to the model with the question. A model that cannot
  look at photos is given the words read out of one (a page, a sign, a
  screenshot), so every model can be asked about a photo of text.
- **Code runs on the phone.** A JavaScript block in a reply has a Run button
  and an HTML one has Preview. The code runs in a web view of its own, shut
  away from the app and its files and with no internet. What it prints, or the
  error it stops on, can be sent back to the model in one tap to be fixed.
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

- iOS does not let an iPhone app use the GPU in the background (the
  allowance for it in iOS 26 covers only iPads with an M3 or newer), and closes
  one that tries. So a reply stops on the GPU as the app leaves the screen.
- **It is then finished in the background.** When a reply starts, the app asks
  iOS for time to finish it (a continued processing task on iOS 26, which
  shows its progress on the Lock Screen; about half a minute before that). If
  the app is left, the model is loaded again on the processor alone, which iOS
  allows, and the reply carries on from its last word, more slowly. A
  notification says when it is done, and tapping it opens the chat. If iOS
  calls time first, a notification says the reply is paused and it carries on
  when the app is opened. Back on screen the model returns to the GPU. Replies
  about photos wait for the app to come back. Settings has a switch for this.
- Without that time, a reply carries on from its last word when the app is
  back, without anything to tap. One that was still thinking is asked again,
  as is a message sent just as the app was left.
- The bottom of Settings says how the app last closed (on screen or in the
  background, and what it was doing), which tells a crash from iOS making room.
- The model stays loaded while the app is in the background, so coming back
  is instant. If iOS closes the app to make room for others, opening it again
  within half an hour returns to the chat that was open.
- Naming a chat and picking out memories also use the model. In a long chat
  they wait until the chat is left, so the next reply does not have to re-read
  the whole conversation.

## The grey chat, and the keyboard

On iOS 26 the whole chat used to go grey once a reply was long enough to reach
the header, which on a phone is usually when the keyboard is up. The cause was
found in the simulator by having the debugger write out the system's list of
views: iOS 26 dims a list where it passes under a bar, and the message list is
drawn upside down so that it grows from the bottom. iOS then gets the place
wrong and lays its dimming, 85% dark, over the whole list.

The chat no longer runs under the header, so there is nothing for iOS to dim.
(Drawing the list the right way up also cures it. Switching the effect off
through the navigation library, hiding the app's own fade and removing the
glass did not.)

Separately, the chat makes room for the keyboard by hand (`src/ui/keyboard.ts`)
rather than with React Native's `KeyboardAvoidingView`, which animates the
whole layout while the screen is being redrawn for a reply.

## Context size

How much a model can keep in mind at once is chosen for each model, to fit the
phone. A loaded model takes memory for the model itself, for its context, and
for working space. The context is the part that can be chosen: its cost per
token is worked out from the details in the model's file (layers, attention
heads and their width), and the largest size is picked that keeps the context
within 7% of the phone's memory and everything together within 60%.

On an 8 GB iPhone that gives the 2B models 8K, most 4B models 4K, Spark-X2.6
4B 3K, and Nemotron Dory and Gemma 4 E4B 2K. Dory's context costs more than
twice as much per token as the other 4B models.

The size depends only on the model and the phone, so the same model always
gets the same context on the same phone. A size can still be picked by hand in
Settings.

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
| `src/lib/context.ts` | Choosing a context size that fits the phone. |
| `src/lib/commands.ts` | The slash commands and how each is written out for the model. |
| `src/lib/logic.ts` | Prompt building, context compaction, titles and memories. |
| `src/lib/models.ts` | The model catalogue and how well each suits a device. |
| `src/lib/db.ts` | The SQLite database: chats, messages, projects and memories. |
| `src/lib/sources.ts` | What can be downloaded into the offline library. |
| `src/lib/library.ts` | The offline library: indexing those downloads and your files. |
| `src/lib/retrieval.ts` | Choosing the passages that fit a question. |
| `src/lib/images.ts` | Photos attached to messages. |
| `src/lib/assistant.ts` | Reading a request to do something on the phone, and the time it names. |
| `src/lib/actions.ts` | Doing it: Reminders, Calendar, Messages, Mail, Phone, Maps, Contacts, Location. |
| `src/lib/notify.ts` | Notifications: a reply that finished or paused while the app was away. |
| `src/lib/runner.ts` | Running code a model wrote: what can be run, and the page that runs it. |
| `src/lib/storage.ts` | Settings and other small preferences. |
| `src/ui/` | Shared pieces: messages, the message box, lists, Markdown, icons. |

## Testing on iOS without an iPhone

The keyboard, the system's bars and Liquid Glass only exist on iOS. A GitHub
Actions workflow builds a test version, runs it in an iOS simulator and keeps
screenshots. See `sim/README.md`.

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
