# Testing on an iOS simulator

Some things can only be seen on iOS: the keyboard, the system's bars, Liquid
Glass. The browser preview shows none of them.

`.github/workflows/ios-simulator.yml` builds a test version of the app on a
Mac in GitHub Actions and runs it in an iOS simulator. That version has no
model in it. It uses the stand-ins from the browser preview, and works itself
through a script (`src/lib/sim.run.ts`) while a screenshot is taken every
second. The screenshots, and the list of what the script was doing when, go to
the `sim-screenshots` branch.

To run it, change the `run` file in this folder and push, or start the
"iOS simulator" workflow by hand on GitHub.

A normal build is not affected: the script and stand-ins are only bundled when
`POCKET_SIM=1` is set (see `metro.config.js`).
