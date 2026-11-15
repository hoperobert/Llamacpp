// Metro configuration: Expo's defaults, plus one switch.
//
// A simulator test build (POCKET_SIM=1) runs on a Mac in GitHub Actions, where
// there is no model to load. It is bundled with the stand-ins from the browser
// preview in place of the model, the downloads and the library, and with a
// script that works the app by itself while screenshots are taken. See
// sim/README.md. Nothing here affects a normal build.

const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

if (process.env.POCKET_SIM === '1') {
  const lib = path.join(__dirname, 'src', 'lib');
  const swaps = { engine: 'engine.web.ts', downloads: 'downloads.web.ts', library: 'library.web.ts', sim: 'sim.run.ts' };
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

module.exports = config;
