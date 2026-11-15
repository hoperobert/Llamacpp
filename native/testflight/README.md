# Building for TestFlight on GitHub

Changing the `build` file in this folder and pushing makes GitHub build the
app and send it to TestFlight (`.github/workflows/ios-testflight.yml`). The
number in it means nothing; it only has to change.

This is the same build Expo's service makes, with the same signing, made on
GitHub's Mac instead. Expo's free plan allows a set number of iOS builds a
month. GitHub's machines are free for a public repository, with no such limit.

It needs one secret in the repository, `EXPO_TOKEN`: an access token made at
expo.dev (Account settings, Access tokens), saved under Settings > Secrets and
variables > Actions.

Most changes do not need a build at all. See "Fixes without a build" in the
README one folder up.
