#!/usr/bin/env bash
# Builds the iPhone app in Expo's cloud and sends it to TestFlight.
# Run from a terminal (a GitHub Codespace works):  ./build-ios.sh
set -e
cd "$(dirname "$0")/native"

[ -d node_modules ] || npm install

# Sign in to Expo unless already signed in.
npx --yes eas-cli@latest whoami >/dev/null 2>&1 || npx --yes eas-cli@latest login

# The first run asks to create the project, then for your Apple sign-in so it
# can set up signing. Answer yes to the questions about generating
# certificates and provisioning profiles.
npx --yes eas-cli@latest build --platform ios --profile production --auto-submit

# The first run writes the new project's ID into app.json. Save it to the
# repository so later builds reuse the same project.
cd ..
if ! git diff --quiet -- native/app.json native/eas.json; then
  git add native/app.json native/eas.json
  git commit -m "Record the Expo project ID"
  git push
  echo "Saved the Expo project ID to the repository."
fi
