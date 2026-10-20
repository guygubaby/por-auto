import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const target = new URL('../src-tauri/resources/u2.jar', import.meta.url);
const sha256 = '0b74e83c55f443539a9f76f5ce023a51466b764b1100e4097a897053fdfc0eb6';
let bytes;
try { bytes = await readFile(process.env.POR_U2_JAR || target); } catch { /* Download on clean builds. */ }
if (!bytes) {
  const response = await fetch('https://github.com/openatx/android-uiautomator-server-jar/releases/download/0.4.0/u2.jar', { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`uiautomator2 download failed: HTTP ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
}
if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error('uiautomator2 0.4.0 checksum mismatch');
await mkdir(new URL('../src-tauri/resources/', import.meta.url), { recursive: true });
await writeFile(target, bytes);
const native = new URL('../native/u2-hint/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', native), 'utf8'));
for (const [name, expected] of [['AccessibilityNodeInfoDumper.java', manifest.sourceSha256], ['classes.dex', manifest.dexSha256]]) {
  if (createHash('sha256').update(await readFile(new URL(name, native))).digest('hex') !== expected) throw Error(`Native editor hint overlay checksum mismatch: ${name}`);
}
await writeFile(new URL('../src-tauri/resources/u2-hint.dex', import.meta.url), await readFile(new URL('classes.dex', native)));
console.log(`Prepared uiautomator2 server 0.4.0 (${(bytes.length / 1048576).toFixed(2)} MiB)`);
