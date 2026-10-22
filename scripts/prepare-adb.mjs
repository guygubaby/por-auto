import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const targets = {
  windows: { suffix: 'win', sha1: 'e03e78b1d80b396f1c3358e31251cb31740e1110' },
  macos: { suffix: 'darwin', sha1: '6ae73f4de6452dc57e62ec02b68eed92a4c21661' },
};
const target = process.argv[2] ?? (process.platform === 'win32' ? 'windows' : 'macos');
if (!(target in targets)) throw new Error('Use windows or macos');
const { suffix, sha1 } = targets[target];
const version = '37.0.1';
const url = `https://dl.google.com/android/repository/platform-tools_r${version}-${suffix}.zip`;
const directory = fileURLToPath(new URL('../assets/', import.meta.url));
await mkdir(directory, { recursive: true });
let bytes;
if (process.env.POR_ADB_ARCHIVE) {
  bytes = await readFile(process.env.POR_ADB_ARCHIVE);
  if (createHash('sha1').update(bytes).digest('hex') !== sha1) throw new Error('Local archive does not match the official repository checksum');
  await writeFile(`${directory}/platform-tools.zip`, bytes);
}
try {
  const manifest = JSON.parse(await readFile(`${directory}/adb-manifest.json`, 'utf8'));
  const cached = await readFile(`${directory}/platform-tools.zip`);
  if (!bytes && manifest.platform === target && createHash('sha1').update(cached).digest('hex') === sha1) bytes = cached;
} catch { /* A clean checkout has no prepared component. */ }
if (!bytes) {
  console.log(`Downloading ${url}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha1').update(bytes).digest('hex') !== sha1) throw new Error('Official repository checksum mismatch');
  await writeFile(`${directory}/platform-tools.zip`, bytes);
}
await writeFile(`${directory}/adb-manifest.json`, JSON.stringify({
  version, platform: target, url, sha256: createHash('sha256').update(bytes).digest('hex'),
}, null, 2) + '\n');
console.log(`Prepared ADB ${version} for ${target}: ${(bytes.length / 1048576).toFixed(2)} MiB`);
