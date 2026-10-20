import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
export const core = require('../mobile/autojs6/updater-core.cjs');
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const origin = { url: 'https://github.com/example/private-scripts', reference: 'main' };

export function adapter(root) {
  const locks = new Set();
  const responses = new Map();
  const requests = [];
  const hooks = {};
  const io = {
    hostVersion: '6.7.0', encode: s => Buffer.from(s), decode: b => b.toString('utf8'),
    sha256: sha, base64: s => Buffer.from(s, 'base64'), now: Date.now, uuid: randomUUID,
    mkdir: p => fs.mkdirSync(p, { recursive: true }), exists: fs.existsSync, readText: p => fs.readFileSync(p, 'utf8'), readBytes: fs.readFileSync,
    writeBytes(p, bytes) { fs.mkdirSync(dirname(p), { recursive: true }); fs.writeFileSync(p, bytes); },
    writeAtomic(p, text) {
      if (hooks.beforeWrite) hooks.beforeWrite(p, text);
      fs.mkdirSync(dirname(p), { recursive: true }); fs.writeFileSync(`${p}.next`, text); fs.renameSync(`${p}.next`, p);
    },
    rename: fs.renameSync, removeTree: p => fs.rmSync(p, { recursive: true, force: true }), list: fs.readdirSync,
    append: fs.appendFileSync,
    withLock(p, fn) {
      if (locks.has(p)) { const error = Error('BUSY'); error.code = 'BUSY'; throw error; }
      locks.add(p); try { return fn(); } finally { locks.delete(p); }
    },
    request(url, token, limit) {
      requests.push({ url, token });
      if (!responses.has(url)) throw Error('offline');
      const bytes = Buffer.from(responses.get(url));
      assert.ok(bytes.length <= limit); return bytes;
    },
    load(p) { const module = { exports: {} }; const fn = vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(p, 'utf8')}\n})`, { filename: p }); fn(createRequire(p), module, module.exports); return module.exports; },
  };
  return { io, hooks, responses, requests, root };
}
export function script(versionCode = 1, content) {
  const bytes = Buffer.from(content || `module.exports = function (por) { var c = por.readConfig(); c.runs = (c.runs || 0) + 1; por.saveConfig(c); por.log('你好', { runs: c.runs }); };`);
  const p = core.catalog({ schemaVersion: 1, workflows: [{ id: 'hello', name: '你好', version: `${versionCode}.0.0`, versionCode, entry: 'main.js', files: [{ path: 'main.js', size: bytes.length, sha256: sha(bytes) }] }] }).workflows[0];
  return { p, bytes, bundle: { schemaVersion: 1, catalog: { schemaVersion: 1, workflows: [p] }, files: [{ id: p.id, path: 'main.js', base64: bytes.toString('base64') }] } };
}
export function online(env, payload, commit = 'a'.repeat(40)) {
  const base = 'https://api.github.com/repos/example/private-scripts/';
  env.responses.set(`${base}commits?sha=main&per_page=1`, JSON.stringify([{ sha: commit }]));
  env.responses.set(`${base}contents/mobile-workflows/registry.json?ref=${commit}`, JSON.stringify({ schemaVersion: 1, workflows: [payload.p] }));
  env.responses.set(`${base}contents/mobile-workflows/hello/src/main.js?ref=${commit}`, payload.bytes);
}
export async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'por-mobile-'));
  const env = adapter(root);
  try { await run(env, core.create(env.io, root, origin)); }
  finally { await rm(root, { recursive: true, force: true }); }
}
