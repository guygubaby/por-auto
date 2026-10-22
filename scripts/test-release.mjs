import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { checkVersion, createManifest } from './release-manifest.mjs';
test('all desktop versions and the retained signing identity must agree', async () => {
  const p = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  assert.equal(await checkVersion('v' + p.version), p.version);
  const config = JSON.parse(
    await readFile(new URL('../mygo.json', import.meta.url), 'utf8'),
  );
  assert.equal(config.updates.deltas, 0, 'Do not advertise unpublished delta files');
  await assert.rejects(checkVersion('v9.9.9'), /must match/);
  await assert.rejects(checkVersion('v1.0.0-beta'), /vMAJOR/);
});
test('release requires signed archives for all three desktop targets', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'por-mygo-release-'));
  const artifacts = resolve(root, 'artifacts');
  await mkdir(artifacts);
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const key = publicKey
    .export({ format: 'der', type: 'spki' })
    .subarray(-32)
    .toString('base64');
  const signature = sign(
    null,
    createHash('sha256').update('fixture').digest(),
    privateKey,
  ).toString('base64');
  try {
    for (const p of ['darwin-arm64', 'darwin-amd64', 'windows-amd64']) {
      const folder = resolve(artifacts, 'release-' + p);
      await mkdir(folder);
      const archive = `PorAuto-0.4.0-${p}.zip`;
      await writeFile(resolve(folder, archive), 'fixture');
      await writeFile(
        resolve(
          folder,
          p.startsWith('darwin') ? `${p}.dmg` : 'PorAuto Setup 0.4.0 amd64.exe',
        ),
        'installer',
      );
      await writeFile(
        resolve(folder, `update-${p}.json`),
        JSON.stringify({
          version: '0.4.0',
          url: `https://github.com/guygubaby/por-auto/releases/download/v0.4.0/${archive}`,
          size: 7,
          signature,
        }),
      );
    }
    const args = {
      artifacts,
      output: resolve(root, 'output'),
      version: '0.4.0',
      repository: 'guygubaby/por-auto',
      publicKey: key,
    };
    const manifest = await createManifest(args);
    assert.equal(Object.keys(manifest.platforms).length, 3);
    const firstArchive = resolve(
      artifacts,
      'release-darwin-arm64/PorAuto-0.4.0-darwin-arm64.zip',
    );
    await writeFile(firstArchive, 'corrupt');
    await assert.rejects(createManifest(args), /signature is invalid/);
    await writeFile(firstArchive, 'fixture');
    await rm(
      resolve(artifacts, 'release-windows-amd64/update-windows-amd64.json'),
    );
    await assert.rejects(
      createManifest({ ...args, output: resolve(root, 'other') }),
      /expected one/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
