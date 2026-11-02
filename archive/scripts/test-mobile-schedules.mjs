import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { core, origin, script, fixture, sha } from './mobile-test-fixture.mjs';

const require = createRequire(import.meta.url);
const cron = require('../mobile/autojs6/cron.cjs');
const scheduling = require('../mobile/autojs6/scheduler-core.cjs');
const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/cron-times.json', import.meta.url), 'utf8'));
const formatters = new Map();
function parts(timezone, epoch) {
  if (!formatters.has(timezone)) formatters.set(timezone, new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }));
  const value = Object.fromEntries(formatters.get(timezone).formatToParts(epoch).filter(part => part.type !== 'literal').map(part => [part.type, +part.value]));
  return [value.year, value.month, value.day, value.hour, value.minute];
}
const clock = {
  validateZone(timezone) { new Intl.DateTimeFormat('en', { timeZone: timezone }); },
  cronInstant(timezone, year, month, day, hour, minute) {
    const nominal = Date.UTC(year, month - 1, day, hour, minute), expected = [year, month, day, hour, minute];
    const offsets = new Set();
    for (let step = -36; step <= 36; step += 6) {
      const at = nominal + step * 3600000, p = parts(timezone, at);
      offsets.add(Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4]) - at);
    }
    const values = [...offsets].map(offset => nominal - offset).filter(at => parts(timezone, at).every((part, i) => part === expected[i])).sort((a, b) => a - b);
    return values[0] ?? null;
  }
};

test('mobile five-field Cron shares desktop time, weekday, leap-year and DST expectations', () => {
  for (const value of cases) {
    if (value.next === null) assert.throws(() => cron.next(value.cron, value.timezone, Date.parse(value.after), clock), /未来/);
    else assert.equal(cron.next(value.cron, value.timezone, Date.parse(value.after), clock), Date.parse(value.next), JSON.stringify(value));
  }
  for (const pattern of ['0 0 9 * * *', '61 * * * *', '* * * * ?', '0 0 L * *', '* * * FOO *', '* * * * 9', '*/0 * * * *', '5-1 * * * *', '1,,2 * * * *', 'NaN * * * *']) assert.throws(() => cron.parse(pattern), pattern);
  assert.throws(() => cron.next('* * * * *', 'Invalid/Zone', Date.now(), clock));
  for (const after of [NaN, Infinity, -1, '0']) assert.throws(() => cron.next('* * * * *', 'UTC', after, clock), /超出/);
  assert.throws(() => cron.next('* * * * *', 'UTC', Date.now(), { ...clock, cronInstant: () => NaN }), /时区计算/);
});

function setup(env, execute) {
  let now = Date.parse('2026-10-20T00:00:00Z');
  Object.assign(env.io, clock, { now: () => now, localTimezone: () => 'Asia/Shanghai' });
  const scheduler = scheduling.create(env.io, env.root, core, cron, execute || ((snapshot, trigger) => core.create(env.io, env.root, snapshot.source).runPinned(snapshot, trigger)));
  env.io.scheduling = scheduler;
  return { scheduler, advance(ms) { now += ms; }, now: () => now };
}
function snapshot(env, payload = script()) {
  const store = join(env.root, 'sources', sha(Buffer.from(`${origin.url}\nmain`)));
  return { source: origin, package: payload.p, cacheName: fs.readdirSync(join(store, 'versions')).find(name => name.startsWith(`${payload.p.id}-${payload.p.versionCode}-`)), config: { text: '冻结消息' }, execution: { workflowId: 'wecom-broadcast', dryRun: true } };
}
const options = { name: '每天预演', cron: '* * * * *', timezone: 'Asia/Shanghai', enabled: true };

test('legacy WeCom test schedules stay paused until explicitly recreated as formal runs', async () => fixture((env, manager) => {
  let executions = 0;
  const { scheduler } = setup(env, () => { executions++; return { id: 'fixture', status: 'completed', error: null }; });
  const payload = script();
  payload.p.id = 'wecom-suite';
  payload.bundle.files[0].id = 'wecom-suite';
  manager.importBundle(payload.bundle);
  const formal = snapshot(env, payload);
  formal.execution.dryRun = false;
  const saved = scheduler.save(options, formal);
  const planFile = join(env.root, 'schedules.json');
  const plans = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  const old = plans.tasks[0];
  old.dryRun = true;
  const pinnedFile = join(env.root, 'schedules', old.id, old.revision + '.json');
  const pinned = JSON.parse(fs.readFileSync(pinnedFile, 'utf8'));
  pinned.execution.dryRun = true;
  const text = JSON.stringify(pinned);
  old.snapshotSha256 = sha(Buffer.from(text));
  fs.writeFileSync(pinnedFile, text);
  fs.writeFileSync(planFile, JSON.stringify(plans));
  scheduler.recover();
  assert.equal(scheduler.list()[0].enabled, false);
  assert.equal(scheduler.list()[0].nextAt, null);
  assert.throws(() => scheduler.enable(saved.id, true), /旧测试任务/);
  assert.equal(scheduler.runNow(saved.id).status, 'failed');
  assert.equal(executions, 0);
  scheduler.save({ ...options, id: saved.id }, formal);
  assert.equal(scheduler.runNow(saved.id).status, 'completed');
  assert.equal(executions, 1);
}));

test('scheduled execution pins code and config while later store updates change the current version', async () => fixture((env, manager) => {
  const { scheduler, advance } = setup(env);
  manager.importBundle(script(1, `module.exports = function (por) {
    if (!por.execution) { por.saveConfig({text:'保存时的消息'}); por.schedules.save(${JSON.stringify(options)}, {workflowId:'wecom-broadcast',dryRun:true}); return; }
    var config = por.readConfig(); config.mutated = true;
    por.recordResult({status:'completed',text:config.text,version:por.versionCode,mode:por.execution.dryRun,unchanged:por.readConfig().mutated===undefined});
  };`).bundle);
  assert.equal(manager.run('hello').status, 'completed');
  const task = scheduler.list()[0]; assert.equal(task.versionCode, 1);
  manager.importBundle(script(2, `module.exports = function(por){por.saveConfig({text:'更新后的消息'});};`).bundle);
  manager.run('hello');
  advance(60000);
  assert.equal(scheduler.tick().status, 'completed');
  assert.equal(scheduler.tick(), null, 'same occurrence is never dispatched twice');
  const record = manager.exportLogs().records.find(item => item.summary.scheduleId === task.id);
  assert.equal(record.summary.versionCode, 1); assert.equal(record.summary.trigger, 'cron');
  assert.deepEqual(record.result, { status: 'completed', text: '保存时的消息', version: 1, mode: true, unchanged: true });
  assert.equal(manager.list().installed[0].versionCode, 2);
  assert.ok(scheduler.list()[0].nextAt > env.io.now());
}));

test('overlap, other tasks, busy operations and stale times are skipped without replay', async () => fixture((env, manager) => {
  let executions = 0, session;
  session = setup(env, () => {
    executions++;
    const active = session.scheduler.list().find(task => task.lastRun?.status === 'running');
    assert.throws(() => session.scheduler.runNow(active.id), /正在执行/, 'overlap cannot invoke the entry twice');
    session.advance(120000); return { id: 'run', status: 'completed', error: null };
  });
  const payload = script(); manager.importBundle(payload.bundle);
  const task = session.scheduler.save(options, snapshot(env, payload));
  const other = session.scheduler.save({ ...options, name: '另一任务' }, snapshot(env, payload));
  session.advance(60000);
  assert.equal(session.scheduler.tick().status, 'completed');
  assert.equal(executions, 1);
  const listed = session.scheduler.list();
  assert.equal(listed.find(item => item.id === task.id).lastSkip.status, 'overlap');
  assert.equal(listed.find(item => item.id === other.id).lastSkip.status, 'busy');
  assert.equal(session.scheduler.tick(), null);
  session.advance(71000);
  assert.equal(session.scheduler.tick(), null); assert.equal(executions, 1);
  assert.ok(session.scheduler.list().every(item => item.lastSkip.status === 'missed'));
  const restarted = scheduling.create(env.io, env.root, core, cron, () => { executions++; throw Error('must not execute'); });
  const path = join(env.root, 'schedules.json'), value = JSON.parse(fs.readFileSync(path));
  value.tasks[0].lastRun.status = 'running'; fs.writeFileSync(path, JSON.stringify(value));
  session.advance(120000); restarted.recover();
  assert.equal(restarted.list()[0].lastRun.status, 'interrupted'); assert.equal(restarted.tick(), null);
  assert.equal(executions, 1);
}));

test('busy execution, failed entries and failed cursor persistence do not replay phone actions', async () => fixture((env, manager) => {
  const { scheduler, advance } = setup(env);
  manager.importBundle(script(1, `module.exports=function(por){por.log('attempt once');throw Error('uncertain send');};`).bundle);
  const task = scheduler.save(options, snapshot(env, script(1, `module.exports=function(por){por.log('attempt once');throw Error('uncertain send');};`)));
  advance(60000);
  env.io.withLock(join(env.root, 'operation.lock'), () => assert.equal(scheduler.tick().status, 'skipped_busy'));
  assert.equal(manager.exportLogs().records.length, 0);
  advance(60000);
  env.hooks.beforeWrite = p => { if (p.endsWith('/schedules.json')) throw Error('disk full'); };
  assert.throws(() => scheduler.tick(), /disk full/); assert.equal(manager.exportLogs().records.length, 0);
  env.hooks.beforeWrite = null;
  assert.equal(scheduler.tick().status, 'failed'); assert.equal(scheduler.tick(), null);
  assert.equal(manager.exportLogs().records.filter(record => record.events.includes('attempt once')).length, 1);
  scheduler.enable(task.id, false); const before = scheduler.list()[0].nextAt;
  assert.equal(before, null); assert.equal(scheduler.runNow(task.id).status, 'failed');
  assert.equal(scheduler.list()[0].nextAt, null, 'run-now does not enable a paused task');
}));

test('deleting a workflow pauses its schedules and keeps pinned bytes and configs for reinstall', async () => fixture((env, manager) => {
  const { scheduler, advance } = setup(env);
  const payload = script(1, `module.exports=function(por){por.recordResult({status:'completed'});};`); manager.importBundle(payload.bundle);
  const task = scheduler.save(options, snapshot(env, payload));
  const store = join(env.root, 'sources', sha(Buffer.from(`${origin.url}\nmain`)));
  const pinnedDir = fs.readdirSync(join(store, 'versions'))[0];
  manager.importBundle(script(2).bundle);
  manager.uninstall('hello'); assert.equal(scheduler.list()[0].enabled, false);
  assert.ok(fs.existsSync(join(store, 'versions', pinnedDir)));
  assert.equal(fs.readdirSync(join(store, 'versions')).length, 1);
  advance(60000); assert.equal(scheduler.tick(), null);
  manager.importBundle(script(2).bundle); scheduler.enable(task.id, true);
  const next = scheduler.list()[0].nextAt;
  scheduler.reschedule(task.id, { name: '改为每天', cron: '0 9 * * *', timezone: 'Asia/Shanghai' });
  assert.notEqual(scheduler.list()[0].nextAt, next); assert.equal(scheduler.list()[0].versionCode, 1);
  assert.equal(scheduler.runNow(task.id).status, 'completed');
  scheduler.remove(task.id); assert.equal(scheduler.list().length, 0); assert.equal(manager.exportLogs().records.length, 1);
}));

test('corrupt task and snapshot files stop before execution and are preserved for debugging', async () => fixture((env, manager) => {
  let attempts = 0; const { scheduler, advance } = setup(env, () => { attempts++; });
  const payload = script(); manager.importBundle(payload.bundle);
  const task = scheduler.save(options, snapshot(env, payload));
  const path = join(env.root, 'schedules', task.id, `${task.revision}.json`);
  fs.appendFileSync(path, 'tampered'); advance(60000);
  assert.equal(scheduler.tick().status, 'failed'); assert.equal(attempts, 0); assert.equal(scheduler.tick(), null);
  assert.ok(fs.readFileSync(path, 'utf8').endsWith('tampered'));
  assert.throws(() => scheduler.enable(task.id, true), /完整性/);
  fs.writeFileSync(join(env.root, 'schedules.json'), 'bad data');
  assert.throws(() => scheduler.recover(), /原文件已保留/);
  assert.equal(fs.readFileSync(join(env.root, 'schedules.json'), 'utf8'), 'bad data');
}));
