// Metro configuration: Expo's defaults, plus one switch.
//
// A simulator test build runs on a Mac in GitHub Actions. It is bundled with a
// script that works the app by itself while screenshots are taken, and with
// POCKET_SIM=1 also with the stand-ins from the browser preview in place of the
// model, the downloads and the library. See sim/README.md. Nothing here affects
// a normal build.

const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// POCKET_SIM=real keeps the real engine and downloads, and only adds the script.
const sim = process.env.POCKET_SIM;
if (sim === '1' || sim === 'real') {
  const lib = path.join(__dirname, 'src', 'lib');
  const swaps = sim === 'real'
    ? { sim: 'sim.run.ts' }
    : { engine: 'engine.web.ts', downloads: 'downloads.web.ts', library: 'library.web.ts', sim: 'sim.run.ts' };
  const upstream = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName.startsWith('.')) {
      const target = path.resolve(path.dirname(context.originModulePath), moduleName);
      const swap = path.dirname(target) === lib && swaps[path.basename(target)];
      if (swap) return { type: 'sourceFile', filePath: path.join(lib, swap) };
    }
    return (upstream ?? context.resolveRequest)(context, moduleName, platform);
  };
}

// POCKET_LITE=1 makes the code for an update to a build of the app made before
// some of its native parts existed (see "Fixes without a build" in the README).
// Code that would call on a missing part closes the app, so each file that
// uses one is swapped for a stand-in that does without.
if (process.env.POCKET_LITE === '1') {
  const at = (...parts) => path.join(__dirname, ...parts);
  const swaps = {
    [at('src', 'lib', 'notify')]: at('src', 'lib', 'notify.lite.ts'),
    [at('src', 'lib', 'actions')]: at('src', 'lib', 'actions.lite.ts'),
    [at('src', 'lib', 'phone')]: at('src', 'lib', 'phone.lite.ts'),
    [at('src', 'lib', 'voice')]: at('src', 'lib', 'voice.lite.ts'),
    [at('src', 'ui', 'Sandbox')]: at('src', 'ui', 'Sandbox.lite.tsx'),
    [at('modules', 'pocket-native')]: at('modules', 'pocket-native', 'index.lite.ts'),
  };
  const upstream = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName.startsWith('.')) {
      const swap = swaps[path.resolve(path.dirname(context.originModulePath), moduleName)];
      if (swap) return { type: 'sourceFile', filePath: swap };
    }
    return (upstream ?? context.resolveRequest)(context, moduleName, platform);
  };
}

module.exports = config;
