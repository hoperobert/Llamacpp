# Pocket LLM

A chat app that runs a language model entirely in the browser, built for iPhone.
After the first visit it works offline. Nothing you type leaves the device.

It uses [wllama](https://github.com/ngxson/wllama) 3.13.0, which is
[llama.cpp](https://github.com/ggml-org/llama.cpp) compiled to WebAssembly with
WebGPU support.

## Models

| Model | Download | Notes |
|---|---|---|
| Qwen3.5 0.8B (Q4_0) | 563 MB | Default. Fastest. |
| Qwen3.5 2B (Q4_K_M) | 1.3 GB | Smarter, slower, needs more memory. |

To try another model, add `?model=<url of a .gguf file>` to the page address.
Single files must be under 2 GB.

## Put it online

The phone needs an HTTPS address for the first load.

1. On GitHub, open **Settings → Pages**.
2. Under **Source**, choose **Deploy from a branch**.
3. Pick the branch and the `/ (root)` folder, then save.
4. The app appears at `https://<user>.github.io/<repo>/` after a minute or two.

## Install on iPhone

1. Open the address in Safari (iOS 26 or later for WebGPU).
2. Tap **Share → Add to Home Screen**.
3. Open it from the home screen, pick a model and tap **Download and start**.

Installing matters: Safari may delete a normal website's stored data after a
week without visits, which would remove the downloaded model.

## Run it locally

```sh
python3 -m http.server 8765
```

Then open `http://localhost:8765/`.

## How it works

- `app.js` is the chat UI. It loads the model with wllama and shows tokens per
  second after each reply.
- `sw.js` is a service worker. It caches the app files for offline use, and adds
  the headers that browsers require for multi-threaded WebAssembly.
- wllama stores the downloaded model in the browser's private file storage
  (OPFS), so it downloads once.
- `vendor/wllama` is the main build. `vendor/wllama-compat` is the build Safari
  uses, because Safari lacks two WebAssembly features the main build needs.

When you change any app file, bump `VERSION` in `sw.js` so installed copies
update.
