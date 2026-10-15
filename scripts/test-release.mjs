import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { checkVersion, createManifest } from './release-manifest.mjs';

test('release tag must match all client versions and enable signed updates', async () => {
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(await checkVersion(`v${version}`), version);
  await assert.rejects(checkVersion('v9.9.9'), /must match/);
  await assert.rejects(checkVersion('v0.1.1-beta'), /vMAJOR/);
});

test('release manifest contains all platforms without filename collisions and rejects incomplete builds', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'por-release-'));
  const signature = Buffer.from('untrusted comment: synthetic test signature\nfixture').toString('base64');
  const platforms = ['darwin-aarch64', 'darwin-x86_64', 'windows-x86_64'];
  const output = resolve(root, 'out');
  try {
    for (const platform of platforms) {
      const folder = resolve(root, `release-${platform}`);
      await mkdir(folder);
      const artifact = resolve(folder, platform.startsWith('darwin') ? 'Por Auto.app.tar.gz' : 'Por Auto-setup.exe');
      await writeFile(artifact, `artifact for ${platform}`);
      await writeFile(`${artifact}.sig`, signature);
    }
    const input = { artifacts: root, output, version: '0.1.1', repository: 'guygubaby/por-auto', notes: 'release notes' };
    const manifest = await createManifest(input);
    assert.deepEqual(Object.keys(manifest.platforms), platforms);
    assert.equal(manifest.notes, 'release notes');
    assert.equal(new Set(Object.values(manifest.platforms).map(p => p.url)).size, 3);
    for (const [platform, entry] of Object.entries(manifest.platforms)) {
      assert.match(entry.url, /^https:\/\/github.com\/guygubaby\/por-auto\/releases\/download\/v0\.1\.1\//);
      assert.equal(entry.signature, signature);
      const filename = entry.url.split('/').at(-1);
      assert.equal(await readFile(resolve(output, filename), 'utf8'), `artifact for ${platform}`);
    }
    assert.equal(JSON.parse(await readFile(resolve(output, 'latest.json'), 'utf8')).version, '0.1.1');
    await rm(resolve(root, 'release-windows-x86_64/Por Auto-setup.exe.sig'));
    await assert.rejects(createManifest(input), /ENOENT/);
    await writeFile(resolve(root, 'release-windows-x86_64/Por Auto-setup.exe.sig'), 'invalid');
    await assert.rejects(createManifest(input), /malformed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
