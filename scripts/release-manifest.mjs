import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { resolve, basename, dirname, relative } from 'node:path';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export async function checkVersion(tag) {
  if (!tag?.startsWith('v') || !stable.test(tag.slice(1)))
    throw Error('Release tag must be vMAJOR.MINOR.PATCH');
  const version = tag.slice(1);
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const config = JSON.parse(await readFile(resolve(root, 'mygo.json'), 'utf8'));
  const engine = await readFile(
    resolve(root, 'internal/automation/engine.go'),
    'utf8',
  );
  const backend = /const Version = "([^"]+)"/.exec(engine)?.[1];
  if ([pkg.version, config.version, backend].some((v) => v !== version))
    throw Error(
      'Tag must match package.json, mygo.json and the Go engine version',
    );
  if (
    Buffer.from(config.updates?.publicKey ?? '', 'base64').length !== 32 ||
    config.updates.github !== 'guygubaby/por-auto'
  )
    throw Error(
      'Signed MyGo updates must use the existing repository and a valid Ed25519 key',
    );
  return version;
}
async function files(folder) {
  const result = [];
  for (const e of await readdir(folder, { withFileTypes: true })) {
    const path = resolve(folder, e.name);
    if (e.isDirectory()) result.push(...(await files(path)));
    else if (e.isFile()) result.push(path);
  }
  return result;
}
export async function createManifest({
  artifacts,
  output,
  version,
  repository,
  notes = '',
  publicKey,
}) {
  if (!stable.test(version) || !/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw Error('Invalid release metadata');
  const destination = relative(resolve(artifacts), resolve(output));
  if (!destination.startsWith('..'))
    throw Error('Release output must be outside the artifact directory');
  const config = JSON.parse(await readFile(resolve(root, 'mygo.json'), 'utf8'));
  const rawKey = Buffer.from(publicKey ?? config.updates.publicKey, 'base64');
  if (rawKey.length !== 32) throw Error('Invalid Ed25519 public key');
  const key = createPublicKey({
    key: Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      rawKey,
    ]),
    format: 'der',
    type: 'spki',
  });
  await mkdir(output, { recursive: true });
  const all = await files(artifacts);
  const result = { version, notes, platforms: {} };
  for (const platform of ['darwin-arm64', 'darwin-amd64', 'windows-amd64']) {
    const candidates = all.filter(
      (p) => basename(p) === `update-${platform}.json`,
    );
    if (candidates.length !== 1)
      throw Error(`${platform}: expected one signed MyGo manifest`);
    const manifest = JSON.parse(await readFile(candidates[0], 'utf8'));
    if (
      manifest.version !== version ||
      Buffer.from(manifest.signature ?? '', 'base64').length !== 64 ||
      !String(manifest.url).startsWith(
        `https://github.com/${repository}/releases/download/v${version}/`,
      )
    )
      throw Error(`${platform}: malformed signed update metadata`);
    const archiveName = decodeURIComponent(
      new URL(manifest.url).pathname.split('/').at(-1),
    );
    const archive = all.find((p) => basename(p) === archiveName);
    if (!archive || (await stat(archive)).size !== manifest.size)
      throw Error(`${platform}: archive is missing or size does not match`);
    const digest = createHash('sha256')
      .update(await readFile(archive))
      .digest();
    if (!verify(null, digest, key, Buffer.from(manifest.signature, 'base64')))
      throw Error(`${platform}: archive signature is invalid`);
    const installers = all.filter(
      (p) =>
        dirname(p) === dirname(candidates[0]) &&
        (platform.startsWith('darwin')
          ? p.endsWith('.dmg')
          : /setup.*\.exe$/i.test(basename(p))),
    );
    if (installers.length !== 1)
      throw Error(`${platform}: expected one installer`);
    await copyFile(archive, resolve(output, archiveName));
    await writeFile(
      resolve(output, basename(candidates[0])),
      JSON.stringify(manifest, null, 2) + '\n',
    );
    result.platforms[platform] = manifest;
  }
  for (const p of all) {
    if (/\.(?:dmg|exe)$/.test(p))
      await copyFile(p, resolve(output, basename(p)));
  }
  return result;
}
async function main() {
  const args = process.argv.slice(2);
  const tag = args[args.indexOf('--tag') + 1];
  const version = await checkVersion(tag);
  if (args.includes('--check')) {
    console.log(
      `Release ${tag}: MyGo, React and Go versions match; signing public key validated`,
    );
    return;
  }
  const notes = (await readFile(resolve(root, 'CHANGELOG.md'), 'utf8'))
    .split(`## ${version}\n`)[1]
    ?.split('\n## ')[0]
    ?.trim();
  if (!notes) throw Error('Missing changelog section');
  await createManifest({
    artifacts: resolve(root, 'release-artifacts'),
    output: resolve(root, 'release-assets'),
    version,
    repository: 'guygubaby/por-auto',
    notes,
  });
  await writeFile(resolve(root, 'release-notes.md'), notes + '\n');
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
