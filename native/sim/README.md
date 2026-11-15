# Testing on an iOS simulator

Some things can only be seen on iOS: the keyboard, the system's bars, Liquid
Glass. The browser preview shows none of them.

`.github/workflows/ios-simulator.yml` builds a test version of the app on a
Mac in GitHub Actions and runs it in an iOS simulator. That version works
itself through a script (`src/lib/sim.run.ts`) while a screenshot is taken
every second: the keyboard coming and going during a reply, stopping a reply,
and leaving the app and coming back while idle, mid-reply and mid-load. The
screenshots, the list of what the script was doing when, and anything the
system recorded about the app closing go to the `sim-screenshots` branch.

The first line of the `run` file in this folder says what to test with:

- `real`: the real engine, which downloads and runs a real small model
  (Qwen3.5 0.8B). This is what finds crashes.
- `1`: the stand-ins from the browser preview, for looking at layout alone.

To run it, change the `run` file and push, or start the "iOS simulator"
workflow by hand on GitHub. On a public repository it costs nothing; a run is
cut off at 45 minutes, and a new run cancels one still going.

A normal build is not affected: the script and stand-ins are only bundled when
`POCKET_SIM` is set (see `metro.config.js`).
