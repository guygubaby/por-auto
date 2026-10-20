import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { buildMobileCatalog, buildBootstrap, assertVersionProgress } from './mobile-scripts.mjs';

const require = createRequire(import.meta.url);
const core = require('../mobile/autojs6/updater-core.cjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const origin = { url: 'https://github.com/example/private-scripts', reference: 'main' };

function adapter(root) {
  let locked = false;
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
    withLock(p, fn) { if (locked) throw Error('BUSY'); locked = true; try { return fn(); } finally { locked = false; } },
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
function script(versionCode = 1, content) {
  const bytes = Buffer.from(content || `module.exports = function (por) { var c = por.readConfig(); c.runs = (c.runs || 0) + 1; por.saveConfig(c); por.log('你好', { runs: c.runs }); };`);
  const p = core.catalog({ schemaVersion: 1, workflows: [{ id: 'hello', name: '你好', version: `${versionCode}.0.0`, versionCode, entry: 'main.js', files: [{ path: 'main.js', size: bytes.length, sha256: sha(bytes) }] }] }).workflows[0];
  return { p, bytes, bundle: { schemaVersion: 1, catalog: { schemaVersion: 1, workflows: [p] }, files: [{ id: p.id, path: 'main.js', base64: bytes.toString('base64') }] } };
}
function online(env, payload, commit = 'a'.repeat(40)) {
  const base = 'https://api.github.com/repos/example/private-scripts/';
  env.responses.set(`${base}commits?sha=main&per_page=1`, JSON.stringify([{ sha: commit }]));
  env.responses.set(`${base}contents/mobile-workflows/registry.json?ref=${commit}`, JSON.stringify({ schemaVersion: 1, workflows: [payload.p] }));
  env.responses.set(`${base}contents/mobile-workflows/hello/src/main.js?ref=${commit}`, payload.bytes);
}
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'por-mobile-'));
  const env = adapter(root);
  try { await run(env, core.create(env.io, root, origin)); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test('offline import runs Chinese script, preserves configuration across version updates and exports logs', async () => fixture((env, manager) => {
  assert.deepEqual(manager.importBundle(script().bundle).updated, ['你好']);
  assert.equal(manager.run('hello').status, 'completed');
  assert.deepEqual(manager.importBundle(script(2).bundle).updated, ['你好']);
  const restarted = core.create(env.io, env.root, origin);
  assert.equal(restarted.run('hello').status, 'completed');
  const logs = restarted.exportLogs();
  assert.equal(logs.records.length, 2);
  assert.ok(logs.records.some(r => r.summary.versionCode === 2 && r.events.includes('"runs":2')));
  assert.equal(restarted.list().installed[0].versionCode, 2);
}));

test('online downloads pin every file to one commit, use private token only on requests and keep old version offline', async () => fixture((env, manager) => {
  manager.importBundle(script().bundle);
  online(env, script(2));
  const result = manager.check('test-private-token');
  assert.deepEqual(result.updated, ['你好']);
  assert.ok(env.requests.every(r => r.token === 'test-private-token'));
  assert.ok(env.requests.slice(1).every(r => r.url.endsWith(`?ref=${'a'.repeat(40)}`)));
  assert.equal(manager.run('hello').status, 'completed');
  env.responses.clear();
  assert.throws(() => manager.check('test-private-token'), /offline/);
  assert.equal(manager.list().installed[0].versionCode, 2);
  assert.equal(manager.run('hello').status, 'completed');
  const all = fs.readdirSync(env.root, { recursive: true, withFileTypes: true }).filter(f => f.isFile()).map(f => fs.readFileSync(join(f.parentPath, f.name)).toString()).join('');
  assert.ok(!all.includes('test-private-token'));
}));

test('bad hash, partial download, downgrade and changed bytes without version bump do not replace current script', async () => fixture((env, manager) => {
  manager.importBundle(script().bundle);
  const next = script(2);
  online(env, next);
  env.responses.set(`https://api.github.com/repos/example/private-scripts/contents/mobile-workflows/hello/src/main.js?ref=${'a'.repeat(40)}`, Buffer.from('truncated'));
  assert.match(manager.check('').errors[0].message, /完整性校验失败/);
  assert.equal(manager.list().installed[0].versionCode, 1);
  const bad = structuredClone(next.bundle); bad.files[0].base64 = Buffer.from('wrong data').toString('base64');
  assert.throws(() => manager.importBundle(bad), /完整性/);
  assert.equal(manager.list().installed[0].versionCode, 1);
  assert.match(manager.importBundle(script(1, 'module.exports = function () {};').bundle).errors[0].message, /未递增/);
  manager.importBundle(next.bundle);
  assert.match(manager.importBundle(script(1).bundle).errors[0].message, /降级/);
}));

test('store refresh lists new versions without installing and keeps offline-only packages visible', async () => fixture((env, manager) => {
  manager.importBundle(script().bundle);
  online(env, script(2));
  manager.refresh('read-only-test-token');
  assert.equal(env.requests.length, 2, 'refresh only requests the commit and catalog');
  assert.equal(manager.list().installed[0].versionCode, 1);
  const [item] = core.storeItems(manager.list());
  assert.equal(item.installed.versionCode, 1); assert.equal(item.available.versionCode, 2); assert.equal(item.update, true);
  const offline = core.storeItems({ installed: [script().p], available: [] });
  assert.equal(offline[0].installed.id, 'hello'); assert.equal(offline[0].available, null); assert.equal(offline[0].update, false);
  assert.equal(core.storeItems({ installed: [], available: [script(2).p] })[0].installed, null);
  manager.install('hello', 'read-only-test-token');
  assert.equal(core.storeItems(manager.list())[0].update, false);
  assert.equal(manager.list().installed[0].versionCode, 2);
}));

test('uninstall is exclusive and atomic, deletes script versions and preserves config and run logs', async () => fixture((env, manager) => {
  manager.importBundle(script().bundle);
  const load = env.io.load;
  env.io.load = p => { assert.throws(() => manager.uninstall('hello'), /BUSY/); return load(p); };
  assert.equal(manager.run('hello').status, 'completed');
  env.hooks.beforeWrite = p => { if (p.endsWith('/state.json')) throw Error('disk full'); };
  assert.throws(() => manager.uninstall('hello'), /disk full/);
  assert.equal(manager.list().installed.length, 1);
  delete env.hooks.beforeWrite;
  assert.deepEqual(manager.uninstall('hello'), { removed: true, warning: null });
  assert.deepEqual(manager.list().installed, []);
  assert.throws(() => manager.run('hello'), /先安装/);
  const store = join(env.root, 'sources', sha(Buffer.from(`${origin.url}\nmain`)));
  assert.equal(fs.readdirSync(join(store, 'versions')).length, 0);
  assert.equal(JSON.parse(fs.readFileSync(join(store, 'config/hello.json'))).runs, 1);
  assert.equal(manager.exportLogs().records.length, 1);
  manager.importBundle(script(2).bundle);
  assert.equal(manager.run('hello').status, 'completed');
  assert.equal(JSON.parse(fs.readFileSync(join(store, 'config/hello.json'))).runs, 2);
}));

test('pointer write failure preserves previous version and a completed staged copy can be safely retried', async () => fixture((env, manager) => {
  manager.importBundle(script().bundle);
  env.hooks.beforeWrite = p => { if (p.endsWith('/state.json')) throw Error('disk full'); };
  assert.match(manager.importBundle(script(2).bundle).errors[0].message, /disk full/);
  assert.equal(manager.list().installed[0].versionCode, 1);
  delete env.hooks.beforeWrite;
  assert.equal(manager.run('hello').status, 'completed');
  assert.deepEqual(manager.importBundle(script(2).bundle).updated, ['你好']);
}));

test('running script excludes updates, source changes isolate data and corrupt local state is not overwritten', async () => fixture((env, manager) => {
  manager.importBundle(script().bundle);
  const load = env.io.load;
  env.io.load = p => { assert.throws(() => manager.importBundle(script(2).bundle), /BUSY/); return load(p); };
  assert.equal(manager.run('hello').status, 'completed');
  assert.equal(manager.list().installed[0].versionCode, 1);
  const other = core.create(env.io, env.root, { url: 'https://github.com/another/repo', reference: 'main' });
  assert.deepEqual(other.list().installed, []);
  const stateFile = join(env.root, 'sources', sha(Buffer.from(`${origin.url}\nmain`)), 'state.json');
  fs.writeFileSync(stateFile, 'broken');
  assert.throws(() => manager.list(), /保留原文件/);
  assert.equal(fs.readFileSync(stateFile, 'utf8'), 'broken');
}));

test('script failures are logged once without replay and installed-byte tampering prevents execution', async () => fixture((env, manager) => {
  manager.importBundle(script(1, `module.exports = function (por) { por.log('send attempted'); throw Error('uncertain send'); };`).bundle);
  assert.equal(manager.run('hello').status, 'failed');
  assert.equal(manager.exportLogs().records.length, 1);
  const entry = fs.readdirSync(join(env.root, 'sources', sha(Buffer.from(`${origin.url}\nmain`)), 'versions'))[0];
  fs.writeFileSync(join(env.root, 'sources', sha(Buffer.from(`${origin.url}\nmain`)), 'versions', entry, 'main.js'), 'tampered');
  assert.throws(() => manager.run('hello'), /完整性/);
  assert.equal(manager.exportLogs().records.length, 1);
}));

test('rejects traversal, duplicate paths, oversized packages and unsupported launchers', async () => fixture((env, manager) => {
  for (const path of ['../x.js', '/x.js', 'a/../../x.js', 'a\\x.js', 'a//x.js', 'a/NUL.txt', 'a/x.', 'a:b.js']) assert.throws(() => core.relative(path));
  for (const url of ['http://github.com/a/b', 'https://github.com.evil/a/b', 'https://token@github.com/a/b', 'https://github.com/a/b/tree/main']) assert.throws(() => core.source({ url }));
  const p = script();
  const duplicate = structuredClone(p.bundle); duplicate.catalog.workflows[0].files.push({ ...p.p.files[0], path: 'MAIN.js' });
  assert.throws(() => manager.importBundle(duplicate), /重复/);
  const oversized = structuredClone(p.bundle); oversized.catalog.workflows[0].files[0].size = core.limits.file + 1;
  assert.throws(() => manager.importBundle(oversized), /大小无效/);
  const unsupported = structuredClone(p.bundle); unsupported.catalog.workflows[0].minLauncher = 2;
  assert.match(manager.importBundle(unsupported).errors[0].message, /新版启动器/);
  manager.importBundle(p.bundle);
  const renamed = structuredClone(p.bundle); renamed.catalog.workflows[0].id = 'HELLO'; renamed.files[0].id = 'HELLO';
  assert.match(manager.importBundle(renamed).errors[0].message, /大小写/);
  assert.equal(manager.list().installed.length, 1);
}));

test('an unfinished run is exported as interrupted without changing or replaying the saved task', async () => fixture((env, manager) => {
  manager.importBundle(script().bundle);
  const run = manager.run('hello');
  const summaryFile = join(env.root, 'runs', run.id, 'summary.json');
  fs.writeFileSync(summaryFile, JSON.stringify({ ...run, status: 'running' }));
  const exported = manager.exportLogs();
  assert.equal(exported.records[0].summary.status, 'interrupted');
  assert.equal(JSON.parse(fs.readFileSync(summaryFile, 'utf8')).status, 'running');
  assert.equal(exported.records.length, 1);
}));

test('actual source package includes verified helper modules and produces a standalone bootstrap', async () => fixture(async (env, manager) => {
  const { catalog, bundle } = await buildMobileCatalog();
  assert.equal(catalog.workflows[0].id, 'demo-hello');
  assert.ok(catalog.workflows[0].files.some(f => f.path === 'lib/message.js'));
  assert.deepEqual(manager.importBundle(bundle).errors, []);
  const bootstrap = await buildBootstrap(bundle);
  new vm.Script(bootstrap);
  assert.ok(bootstrap.startsWith('"ui";'), 'the store needs AutoJs6 UI mode');
  assert.ok(bootstrap.includes('手机工作流商店'));
  assert.ok(bootstrap.includes('createAutoJs6Runtime'));
  assert.ok(!bootstrap.includes('node:fs'));
}));

test('publisher requires increasing versionCode when source or execution requirements change', () => {
  const previous = { workflows: [script().p] };
  assert.throws(() => assertVersionProgress(previous, { workflows: [script(1, 'module.exports = function () {};').p] }), /increment versionCode/);
  assert.doesNotThrow(() => assertVersionProgress(previous, { workflows: [script(2).p] }));
});
