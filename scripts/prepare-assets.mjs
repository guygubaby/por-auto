import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
for (const directory of ['assets/runtime', 'assets/workflows', 'assets/mobile'])
  await rm(new URL(directory, root), { recursive: true, force: true });
for (const directory of ['assets/runtime', 'assets/workflows', 'assets/mobile'])
  await mkdir(new URL(directory, root), { recursive: true });
for (const name of ['core.js', 'request.js'])
  await copyFile(
    new URL(`mobile-workflows/shared/src/${name}`, root),
    new URL(`assets/runtime/${name}`, root),
  );
await copyFile(new URL('mobile-workflows/wecom-suite/src/wecom-ids.js',root),new URL('assets/runtime/wecom-ids.js',root));
for (const name of ['por-input.apk', 'manifest.json'])
  await copyFile(
    new URL(`native/android-input/artifacts/${name}`, root),
    new URL(
      `assets/${name === 'manifest.json' ? 'input-manifest.json' : name}`,
      root,
    ),
  );
await copyFile(
  new URL('mobile/autojs6/bootstrap.js', root),
  new URL('assets/mobile/bootstrap.js', root),
);
await copyFile(
  new URL('mobile-workflows/offline-bundle.json', root),
  new URL('assets/mobile/offline-bundle.json', root),
);
const registry = JSON.parse(
  await readFile(new URL('workflows/registry.json', root), 'utf8'),
);
for (const workflow of registry.workflows) {
  await copyFile(
    new URL(workflow.path, root),
    new URL(`assets/workflows/${workflow.id}.json`, root),
  );
}
const manifest = JSON.parse(
  await readFile(new URL('assets/adb-manifest.json', root), 'utf8'),
);
assert.equal(
  createHash('sha256')
    .update(await readFile(new URL('assets/platform-tools.zip', root)))
    .digest('hex'),
  manifest.sha256,
);
console.log(
  'MyGo resources: input, shared workflows, mobile bundle and ADB hashes verified',
);
