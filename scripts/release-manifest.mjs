import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const platforms = ['darwin-aarch64', 'darwin-x86_64', 'windows-x86_64'];
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export async function checkVersion(tag) {
  if (!tag?.startsWith('v') || !stableVersion.test(tag.slice(1))) throw new Error('Release tag must be vMAJOR.MINOR.PATCH');
  const version = tag.slice(1);
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const config = JSON.parse(await readFile(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8'));
  const cargo = await readFile(resolve(root, 'src-tauri/Cargo.toml'), 'utf8');
  const cargoVersion = cargo.match(/^version = "([^"]+)"/m)?.[1];
  if ([pkg.version, config.version, cargoVersion].some(value => value !== version)) {
    throw new Error(`Tag ${tag} must match package.json, Cargo.toml and tauri.conf.json`);
  }
  if (config.bundle.createUpdaterArtifacts !== true || !config.plugins?.updater?.pubkey) throw new Error('Signed updater artifacts must be enabled');
  const endpoint = config.plugins.updater.endpoints?.[0];
  if (endpoint !== 'https://github.com/guygubaby/por-auto/releases/latest/download/latest.json') throw new Error('Unexpected update feed');
  return version;
}

async function files(folder) {
  const result = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = resolve(folder, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

export async function createManifest({ artifacts, output, version, repository, notes = '' }) {
  if (!stableVersion.test(version)) throw new Error('Invalid stable version');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid repository');
  const entries = [];
  for (const platform of platforms) {
    const paths = await files(resolve(artifacts, `release-${platform}`));
    const suffix = platform.startsWith('darwin') ? '.app.tar.gz' : '.exe';
    const candidates = paths.filter(path => path.endsWith(suffix));
    if (candidates.length !== 1) throw new Error(`${platform}: expected one updater artifact`);
    const path = candidates[0];
    if (!(await stat(path)).size) throw new Error(`${platform}: empty updater artifact`);
    const signature = (await readFile(`${path}.sig`, 'utf8')).trim();
    if (!Buffer.from(signature, 'base64').toString('utf8').startsWith('untrusted comment:')) {
      throw new Error(`${platform}: missing or malformed Tauri signature`);
    }
    const name = `PorAuto_${version}_${platform}${suffix === '.exe' ? '-setup.exe' : suffix}`;
    const dmg = paths.find(path => path.endsWith('.dmg'));
    entries.push({ platform, path, name, signature, dmg });
  }
  const manifest = { version, notes, pub_date: new Date().toISOString(), platforms: {} };
  await mkdir(output, { recursive: true });
  for (const entry of entries) {
    manifest.platforms[entry.platform] = {
      signature: entry.signature,
      url: `https://github.com/${repository}/releases/download/v${version}/${entry.name}`,
    };
    await copyFile(entry.path, resolve(output, entry.name));
    await copyFile(`${entry.path}.sig`, resolve(output, `${entry.name}.sig`));
    if (entry.dmg) await copyFile(entry.dmg, resolve(output, `PorAuto_${version}_${entry.platform}.dmg`));
  }
  await writeFile(resolve(output, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function main() {
  const args = process.argv.slice(2);
  const value = key => args[args.indexOf(key) + 1];
  const tag = value('--tag');
  const version = await checkVersion(tag);
  if (args.includes('--check')) {
    console.log(`Release ${tag}: versions and updater configuration match`);
    return;
  }
  const changelog = await readFile(resolve(root, 'CHANGELOG.md'), 'utf8');
  const section = changelog.split(`## ${version}\n`)[1]?.split('\n## ')[0]?.trim();
  if (!section) throw new Error(`CHANGELOG.md is missing version ${version}`);
  await createManifest({
    artifacts: resolve(root, 'release-artifacts'),
    output: resolve(root, 'release-assets'),
    version,
    repository: process.env.GITHUB_REPOSITORY || 'guygubaby/por-auto',
    notes: section,
  });
  await writeFile(resolve(root, 'release-notes.md'), section);
  console.log(`Release ${tag}: verified all 3 signed platform artifacts and generated latest.json`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
