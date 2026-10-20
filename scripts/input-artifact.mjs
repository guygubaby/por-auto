import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../native/android-input/', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const artifact = resolve(root, 'artifacts/por-input.apk');
const manifest = resolve(root, 'artifacts/manifest.json');
export function assertInputVersionProgress(previous, current) {
  assert.ok(current.versionCode>=previous.versionCode,'Input component versionCode cannot decrease');
  if(previous.sha256!==current.sha256)assert.ok(current.versionCode>previous.versionCode,'Input component bytes changed; increment versionCode before publishing');
}
async function sources(folder = root, prefix = '') {
  const result = {};
  for (const item of (await readdir(folder, { withFileTypes: true })).sort((a,b)=>a.name.localeCompare(b.name))) {
    if (['build','.gradle','.kotlin','.idea','artifacts'].includes(item.name)) continue;
    const name = prefix + item.name;
    if (item.isDirectory()) Object.assign(result, await sources(resolve(folder,item.name),name+'/'));
    else if (/\.(?:kt|kts|toml|xml)$/.test(name) || ['gradle.properties','gradlew','gradlew.bat','gradle/wrapper/gradle-wrapper.properties','gradle/wrapper/gradle-wrapper.jar'].includes(name)) {
      assert.ok(item.isFile() && !item.isSymbolicLink(), 'Input source must be a regular file: '+name);
      result[name] = digest(await readFile(resolve(root,name)));
    }
  }
  return result;
}
async function certificate() {
  const source = await readFile(new URL('../mobile-workflows/wechat-suite/src/native-input.js', import.meta.url),'utf8');
  return /var CERTIFICATE = '([a-f0-9]{64})';/.exec(source)?.[1];
}
export async function readInputArtifact() {
  const metadata = JSON.parse(await readFile(manifest,'utf8'));
  assert.equal(metadata.schemaVersion,1);assert.equal(metadata.protocolVersion,1);assert.equal(metadata.applicationId,'com.por.auto.input');
  assert.ok(Number.isSafeInteger(metadata.versionCode)&&metadata.versionCode>0);assert.equal(metadata.minSdk,26);
  const signer=await certificate();assert.match(signer||'',/^[a-f0-9]{64}$/);assert.equal(metadata.certificateSha256,signer);
  assert.deepEqual(metadata.sources,await sources(),'Input component source changed; rebuild and sign before packaging');
  const bytes = await readFile(artifact);
  assert.equal(bytes.length,metadata.bytes);assert.equal(digest(bytes),metadata.sha256);
  assert.ok(bytes.length>0 && bytes.length<=1024*1024 && bytes.subarray(0,2).toString()==='PK');
  return {...metadata,bytes};
}
async function writeArtifact() {
  const code = await readFile(resolve(root,'app/build.gradle.kts'),'utf8');
  const versionCode = Number(/versionCode\s*=\s*(\d+)/.exec(code)?.[1]);
  assert.ok(Number.isSafeInteger(versionCode) && versionCode>0);
  const directory = resolve(root,'app/build/outputs/apk/release');
  const built = JSON.parse(await readFile(resolve(directory,'output-metadata.json'),'utf8'));
  assert.equal(built.applicationId,'com.por.auto.input');assert.equal(built.elements.length,1);assert.equal(built.elements[0].versionCode,versionCode);
  const apk = resolve(directory,built.elements[0].outputFile);
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;assert.ok(sdk,'Set ANDROID_HOME before recording a signed input component');
  const signature = execFileSync(resolve(sdk,'build-tools/34.0.0/apksigner'),['verify','--print-certs',apk],{encoding:'utf8'});
  const certificateSha256 = await certificate();assert.ok(certificateSha256);
  assert.ok(signature.includes('Signer #1 certificate SHA-256 digest: '+certificateSha256),'Input signing identity changed; preserve the existing identity');
  const bytes = await readFile(apk);
  try { assertInputVersionProgress(JSON.parse(await readFile(manifest,'utf8')),{versionCode,sha256:digest(bytes)}); }
  catch(error) {if(error.code!=='ENOENT')throw error;}
  await mkdir(resolve(root,'artifacts'),{recursive:true});await writeFile(artifact,bytes);
  await writeFile(manifest,JSON.stringify({schemaVersion:1,protocolVersion:1,applicationId:'com.por.auto.input',versionCode,minSdk:26,bytes:bytes.length,sha256:digest(bytes),certificateSha256,sources:await sources()},null,2)+'\n');
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.includes('--write')) await writeArtifact();
  const input = await readInputArtifact();
  console.log(`Input component v${input.versionCode}: ${(input.bytes.length/1024).toFixed(1)} KiB, source and artifact hashes verified`);
}
