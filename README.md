# Pocket LLM

A chat app that runs a language model entirely in the browser, built for iPhone.
After the first visit it works offline. Nothing you type leaves the device.

It uses [wllama](https://github.com/ngxson/wllama) 3.13.0, which is
[llama.cpp](https://github.com/ggml-org/llama.cpp) compiled to WebAssembly with
WebGPU support. The bundled engine is llama.cpp build `b12211`.

There is also a native iPhone app in [`native/`](native/README.md), which adds
true background downloads and room for bigger models.

## Features

- **Chats** are saved on the device and listed in the side menu.
- **Context meter** in the header shows how full the model's context is. When a
  chat outgrows it, older messages are summarised (or dropped, if you turn
  summaries off) so the chat can continue.
- **Memories** are facts about you that carry across chats. They are saved
  automatically when you mention something about yourself, by typing
  `/remember ...`, or by adding them in Settings.
- **Downloads** resume where they left off after a dropped connection, a
  pause, or closing the app, and retry by themselves until they finish.
  Models and the engine files are kept across app updates.
- **Settings** cover the model, custom instructions, memory, reply length and
  creativity, thinking mode, context size, GPU use, theme, text size and data
  export or deletion.

## Models

| Model | Download | Notes |
|---|---|---|
| Qwen3.5 0.8B (Q4_0) | 563 MB | Default. Fastest. |
| Qwen3.5 2B (Q4_K_M) | 1.3 GB | Smarter, slower, needs more memory. |

To try another model, add `?model=<url of a .gguf file>` to the page address.
Single files must be under 2 GB.

## Put it online (GitHub Pages)

The site is the repository root. There is no build step.

1. On GitHub, open **Settings → Pages**.
2. Under **Source**, choose **Deploy from a branch**.
3. Pick the branch and the `/ (root)` folder, then save.
4. The app appears at `https://<user>.github.io/<repo>/` after a minute or two.

It redeploys on every push to that branch.

## Install on iPhone

1. Open the address in Safari (iOS 26 or later for WebGPU).
2. Tap **Share → Add to Home Screen**.
3. Open it from the home screen, pick a model and tap **Download**.

Installing matters: Safari may delete a normal website's stored data after a
week without visits, which would remove the downloaded model.

## Run it locally

```sh
python3 -m http.server 8765
```

Then open `http://localhost:8765/`.

## Code map

| File | Purpose |
|---|---|
| `js/app.js` | Interface, context handling, memories, settings. |
| `js/engine.js` | Model list, download, loading and generation through wllama. |
| `js/store.js` | On-device storage (IndexedDB) for chats, memories and settings. |
| `js/markdown.js` | Safe Markdown rendering for replies. |
| `js/download-worker.js` | Resumable model downloader with automatic retry. |
| `sw.js` | Service worker that caches the app for offline use. |
| `vendor/wllama` | Main engine build. |
| `vendor/wllama-compat` | Build for Safari, which lacks two WebAssembly features the main build needs. |

When you change any app file, bump `VERSION` in `sw.js` so installed copies
update. Bump `ENGINE_VERSION` only when the files under `vendor/` change;
otherwise updates reuse the engine files already on the device.
