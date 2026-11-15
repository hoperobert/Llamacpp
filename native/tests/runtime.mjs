// Over-the-air updates only go to builds with the same "runtime version"
// (app.json). It has to change whenever the native side of the app changes,
// or an update could reach a build that lacks something it needs.
//
// This keeps a fingerprint of everything that decides the native side: the
// packages, the patches to them, and the app's configuration. `npm test` fails
// when that has changed and the runtime version has not been raised with it.
// After raising it, run `npm run runtime:lock`.

import { createHash } from 'node:crypto';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');

export function current() {
  const pkg = JSON.parse(read('package.json'));
  const config = JSON.parse(read('app.json')).expo;
  const { runtimeVersion, ...rest } = config;
  const patches = fs.readdirSync(new URL('patches/', root)).sort().map((name) => [name, read(`patches/${name}`)]);
  const native = JSON.stringify([pkg.dependencies, patches, rest, JSON.parse(read('eas.json')).build]);
  return { runtimeVersion, native: createHash('sha256').update(native).digest('hex') };
}

const lockFile = new URL('runtime-lock.json', root);

if (process.argv.includes('--lock')) {
  fs.writeFileSync(lockFile, `${JSON.stringify(current(), null, 2)}\n`);
  console.log('runtime: locked', current().runtimeVersion);
} else {
  const locked = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  const now = current();
  if (now.native !== locked.native && now.runtimeVersion === locked.runtimeVersion) {
    console.error(
      'The native side of the app has changed (packages, patches or app.json) since runtime version ' +
      `"${locked.runtimeVersion}" was set.\nRaise "runtimeVersion" in app.json, then run: npm run runtime:lock\n` +
      'A build made after that will only take updates published after it.',
    );
    process.exit(1);
  }
  if (now.native !== locked.native || now.runtimeVersion !== locked.runtimeVersion) {
    console.error('The runtime version was raised. Record it with: npm run runtime:lock');
    process.exit(1);
  }
  console.log('runtime: all checks passed');
}
