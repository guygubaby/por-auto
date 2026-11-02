import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { buildMobileCatalog, buildBootstrap, assertVersionProgress } from './mobile-scripts.mjs';
import { core, sha, origin, script, online, fixture } from './mobile-test-fixture.mjs';

test('offline import runs Chinese script, preserves configuration across version updates and exports logs', async () => fixture((env, manager) => {
  assert.deepEqual(manager.importBundle(script().bundle).updated, ['你好']);
  assert.equal(manager.run('hello').status, 'completed');
  assert.deepEqual(manager.importBundle(script(2).bundle).updated, ['你好']);
  const restarted = core.create(env.io, env.root, origin);
  assert.equal(restarted.run('hello').status, 'completed');
  const logs = restarted.exportLogs();
  assert.equal(logs.records.length, 2);
  assert.ok(logs.records.some(r => r.summary.versionCode === 2));
  assert.ok(logs.records.every(r => r.events === ''));
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

test('debug exports include 1000 durable recipient results across restarts and failures', async () => fixture((env, manager) => {
  manager.importBundle(script(1, `module.exports = function (por) {
    por.recordResult({schemaVersion:1,runId:por.runId,status:'completed',targets:Array.from({length:1000},function(_,i){return {title:'测试群'+i,status:'rehearsed'};})});
  };`).bundle);
  assert.equal(manager.run('hello').status, 'completed');
  const restarted = core.create(env.io, env.root, origin);
  let records = restarted.exportLogs().records;
  assert.equal(records[0].result.targets.length, 1000);
  assert.equal(records[0].result.targets[999].title, '测试群999');
  assert.ok(records[0].result.targets.every(t => t.status === 'rehearsed'));
  manager.importBundle(script(2, `module.exports = function (por) {
    por.recordResult({schemaVersion:1,runId:por.runId,status:'running',targets:[{title:'群甲',status:'uncertain'},{title:'群乙',status:'skipped'}]});throw Error('execution interrupted');
  };`).bundle);
  const failed = manager.run('hello'); assert.equal(failed.status, 'failed');
  records = restarted.exportLogs().records;
  const result = records.find(r => r.summary.id === failed.id).result;
  assert.equal(result.status, 'failed'); assert.equal(result.error, 'execution interrupted');
  assert.deepEqual(result.targets.map(t => t.status), ['uncertain', 'skipped']);
  assert.equal(JSON.parse(fs.readFileSync(join(env.root,'runs',failed.id,'result.json'))).status, 'running', 'exports do not rewrite the original evidence');
}));

test('invalid result snapshots do not replace saved evidence or replay entry actions', async () => fixture((env, manager) => {
  for (const invalid of ['null', '[]', "{text:'中'.repeat(800000)}", '{toJSON:function(){return null;}}']) {
    const payload = script(1, `module.exports = function (por) { por.recordResult({status:'running',targets:[{title:'群甲',status:'pending'}]}); por.recordResult(${invalid}); por.log('must not run'); };`);
    const isolated = core.create(env.io, env.root, { url: 'https://github.com/example/repo-' + sha(payload.bytes).slice(0,8) });
    isolated.importBundle(payload.bundle);
    const run = isolated.run('hello'); assert.equal(run.status, 'failed');
    const saved = JSON.parse(fs.readFileSync(join(env.root, 'runs', run.id, 'result.json')));
    assert.equal(saved.status, 'running'); assert.equal(saved.targets[0].title, '群甲');
    assert.ok(!fs.readFileSync(join(env.root, 'runs', run.id, 'events.jsonl'), 'utf8').includes('must not run'));
  }
}));

test('rejects traversal, duplicate paths, oversized packages and unsupported launchers', async () => fixture((env, manager) => {
  for (const path of ['../x.js', '/x.js', 'a/../../x.js', 'a\\x.js', 'a//x.js', 'a/NUL.txt', 'a/x.', 'a:b.js']) assert.throws(() => core.relative(path));
  for (const url of ['http://github.com/a/b', 'https://github.com.evil/a/b', 'https://token@github.com/a/b', 'https://github.com/a/b/tree/main']) assert.throws(() => core.source({ url }));
  const p = script();
  const duplicate = structuredClone(p.bundle); duplicate.catalog.workflows[0].files.push({ ...p.p.files[0], path: 'MAIN.js' });
  assert.throws(() => manager.importBundle(duplicate), /重复/);
  const oversized = structuredClone(p.bundle); oversized.catalog.workflows[0].files[0].size = core.limits.file + 1;
  assert.throws(() => manager.importBundle(oversized), /大小无效/);
  const unsupported = structuredClone(p.bundle); unsupported.catalog.workflows[0].minLauncher = core.launcherVersion + 1;
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

test('mobile history keeps only the latest 200 runs and success has no diagnostic log', async () => fixture((env, manager) => {
  manager.importBundle(script().bundle);
  for (let index = 1; index <= 205; index++) {
    const id = `${index}-a`, folder = join(env.root, 'runs', id);
    fs.mkdirSync(folder);
    fs.writeFileSync(join(folder, 'summary.json'), JSON.stringify({ id, timestamp: index, status: 'completed' }));
    fs.writeFileSync(join(folder, 'old.log'), 'old heavy evidence');
  }
  manager.exportLogs();
  assert.equal(fs.readdirSync(join(env.root, 'runs')).length, 200);
  assert.equal(fs.existsSync(join(env.root, 'runs/1-a')), false);
  const result = manager.run('hello');
  assert.equal(result.status, 'completed');
  assert.equal(fs.readdirSync(join(env.root, 'runs')).length, 200);
  assert.equal(fs.existsSync(join(env.root, 'runs', result.id, 'events.jsonl')), false);
  assert.equal(manager.exportLogs().records[0].summary.id, result.id);
}));

test('mobile failure writes only the last 32 events', async () => fixture((env, manager) => {
  manager.importBundle(script(1, `module.exports = function(por){ for(var n=0;n<500;n++)por.log('marker'+n); throw Error('task failed'); };`).bundle);
  const result = manager.run('hello');
  assert.equal(result.status, 'failed');
  const events = manager.exportLogs().records[0].events.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(events.length, 32);
  assert.equal(events.at(-1).details.error, 'task failed');
  assert.ok(events.some(event => event.message === 'marker499'));
  assert.ok(events.every(event => event.message !== 'marker0'));
}));

test('latest result export reads retained history without a duplicate last-result file', async () => fixture((env, manager) => {
  manager.importBundle(script(1, `module.exports=function(por){por.recordResult({status:'completed',marker:'previous'});};`).bundle);
  assert.equal(manager.run('hello').status, 'completed');
  const dev = core.create(env.io, env.root, { ...origin, reference: 'dev' });
  dev.importBundle(script(1, `module.exports=function(por){por.recordResult({status:'completed',marker:'wrong-branch'});};`).bundle);
  assert.equal(dev.run('hello').status, 'completed');
  manager.importBundle(script(2, `module.exports=function(por){var last=por.readLastResult();por.recordResult({status:'completed',previous:last.marker});};`).bundle);
  const run = manager.run('hello');
  assert.equal(run.status, 'completed');
  const saved = JSON.parse(fs.readFileSync(join(env.root, 'runs', run.id, 'result.json')));
  assert.equal(saved.previous, 'previous');
}));

test('diagnostic write failure cannot hide the terminal mobile summary', async () => fixture((env, manager) => {
  manager.importBundle(script(1, `module.exports=function(){throw Error('original failure');};`).bundle);
  env.hooks.beforeWrite = path => { if (path.endsWith('/events.jsonl')) throw Error('disk log failed'); };
  const run = manager.run('hello');
  assert.equal(run.status, 'failed');
  const saved = JSON.parse(fs.readFileSync(join(env.root, 'runs', run.id, 'summary.json')));
  assert.equal(saved.status, 'failed');
  assert.equal(saved.error, 'original failure');
  assert.match(saved.warning, /诊断日志/);
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
