'use strict';

function create(io, root, core, cron, execute) {
  var file = root + '/schedules.json';
  function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
  function validId(value) { return typeof value === 'string' && /^[a-f0-9-]{16,80}$/.test(value); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function origin(value) { var normalized = core.source(value); return normalized.url + '\n' + normalized.reference; }
  function time(value) { return typeof value === 'number' && value % 1 === 0 && value >= 0; }
  function state() {
    if (!io.exists(file)) return { schemaVersion: 1, tasks: [] };
    var value;
    try { value = JSON.parse(io.readText(file)); } catch (_) { throw new Error('定时任务配置损坏，原文件已保留'); }
    if (!object(value) || value.schemaVersion !== 1 || !Array.isArray(value.tasks) || value.tasks.length > 100) throw new Error('定时任务列表格式无效，原文件已保留');
    var ids = [];
    value.tasks.forEach(function (task) {
      if (!object(task) || !validId(task.id) || ids.indexOf(task.id) >= 0 || !validId(task.revision) || typeof task.name !== 'string' || !task.name.trim() || task.name.length > 100
          || typeof task.enabled !== 'boolean' || (task.enabled ? !time(task.nextAt) : task.nextAt !== null) || !/^[a-f0-9]{64}$/.test(task.snapshotSha256)
          || typeof task.scriptId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(task.scriptId)
          || typeof task.cacheName !== 'string' || !new RegExp('^' + task.scriptId + '-[0-9]+-[a-f0-9]{64}$').test(task.cacheName)) throw new Error('定时任务数据无效，原文件已保留');
      origin(task.source); cron.parse(task.cron); io.validateZone(task.timezone); ids.push(task.id);
    });
    return value;
  }
  function locked(action) { return io.withLock(root + '/schedule.lock', action); }
  function persist(value) { io.writeAtomic(file, JSON.stringify(value, null, 2) + '\n'); }
  function next(task, after) { return cron.next(task.cron, task.timezone, after, io); }
  function snapshotFile(task) { return root + '/schedules/' + task.id + '/' + task.revision + '.json'; }
  function publicTask(task) {
    var value = clone(task); delete value.snapshotSha256; delete value.cacheName; return value;
  }
  function save(options, snapshot) {
    if (!object(options) || typeof options.name !== 'string' || !options.name.trim() || options.name.length > 100 || /[\x00-\x1f\x7f]/.test(options.name)
        || typeof options.enabled !== 'boolean' || !object(snapshot) || !object(snapshot.config) || !object(snapshot.execution)
        || !/^[a-zA-Z0-9_-]{1,80}$/.test(snapshot.execution.workflowId || '') || typeof snapshot.execution.dryRun !== 'boolean') throw new Error('定时任务名称、配置或运行方式无效');
    var p = core.catalog({ schemaVersion: 1, workflows: [snapshot.package] }).workflows[0];
    var source = core.source(snapshot.source), nextAt = cron.next(options.cron, options.timezone, io.now(), io);
    var text = JSON.stringify(snapshot);
    if (io.encode(text).length > 2 * 1024 * 1024) throw new Error('定时任务配置快照超过 2 MiB');
    if (typeof snapshot.cacheName !== 'string' || !new RegExp('^' + p.id + '-' + p.versionCode + '-[a-f0-9]{64}$').test(snapshot.cacheName)) throw new Error('定时任务代码快照无效');
    return locked(function () {
      var current = state(), previous = null;
      if (options.id) {
        previous = current.tasks.filter(function (task) { return task.id === options.id; })[0];
        if (!previous || origin(previous.source) !== origin(source) || previous.scriptId !== p.id) throw new Error('找不到当前工作流的定时任务');
        if (previous.lastRun && previous.lastRun.status === 'running') throw new Error('任务正在执行，请结束后再编辑');
      } else if (current.tasks.length >= 100) throw new Error('最多保存 100 个手机定时任务');
      var task = { id: previous ? previous.id : io.uuid(), revision: io.uuid(), name: options.name.trim(), source: source,
        scriptId: p.id, scriptName: p.name, version: p.version, versionCode: p.versionCode, workflowId: snapshot.execution.workflowId, dryRun: snapshot.execution.dryRun,
        cacheName: snapshot.cacheName, snapshotSha256: io.sha256(io.encode(text)), cron: options.cron.trim().replace(/\s+/g, ' '), timezone: options.timezone,
        enabled: options.enabled, nextAt: options.enabled ? nextAt : null, createdAt: previous ? previous.createdAt : io.now(), updatedAt: io.now(), lastRun: previous ? previous.lastRun : null, lastSkip: previous ? previous.lastSkip : null };
      io.mkdir(root + '/schedules/' + task.id); io.writeAtomic(snapshotFile(task), text);
      current.tasks = current.tasks.filter(function (item) { return item.id !== task.id; }); current.tasks.push(task); persist(current);
      if (previous) { try { io.removeTree(snapshotFile(previous)); } catch (_) {} }
      return publicTask(task);
    });
  }
  function find(current, id) { var task = current.tasks.filter(function (item) { return item.id === id; })[0]; if (!task) throw new Error('定时任务不存在'); return task; }
  function skip(task, status, scheduledAt, at) { task.lastSkip = { status: status, scheduledAt: scheduledAt, at: at }; }
  function recover() {
    return locked(function () {
      var current = state(), now = io.now();
      current.tasks.forEach(function (task) {
        if (task.lastRun && task.lastRun.status === 'running') { task.lastRun.status = 'interrupted'; task.lastRun.error = '执行会话已停止，未自动重试'; task.lastRun.finishedAt = now; }
        if (task.enabled && task.nextAt <= now) { skip(task, 'missed', task.nextAt, now); task.nextAt = next(task, now); }
      }); persist(current);
    });
  }
  function loadSnapshot(task) {
    var bytes = io.readBytes(snapshotFile(task));
    if (bytes.length > 2 * 1024 * 1024 || io.sha256(bytes) !== task.snapshotSha256) throw new Error('定时任务快照缺失或完整性校验失败');
    var value = JSON.parse(io.decode(bytes));
    if (!object(value) || !object(value.config) || !object(value.execution) || value.execution.workflowId !== task.workflowId || value.execution.dryRun !== task.dryRun
        || origin(value.source) !== origin(task.source) || value.package.id !== task.scriptId || value.package.versionCode !== task.versionCode || value.cacheName !== task.cacheName) throw new Error('定时任务快照与计划不匹配');
    return value;
  }
  function claim(id) {
    return locked(function () {
      var current = state(), now = io.now(), selected = id ? find(current, id) : null, changed = false;
      if (!id) {
        current.tasks.sort(function (a, b) { return (a.nextAt || Infinity) - (b.nextAt || Infinity); });
        current.tasks.forEach(function (task) {
          if (!task.enabled || task.nextAt > now) return;
          if (now - task.nextAt > 10000) { skip(task, 'missed', task.nextAt, now); task.nextAt = next(task, now); changed = true; }
          else if (!selected) selected = task;
        });
      }
      if (!selected) { if (changed) persist(current); return null; }
      if (selected.lastRun && selected.lastRun.status === 'running') {
        if (id) throw new Error('任务正在执行，未重复启动');
        skip(selected, 'overlap', selected.nextAt, now); selected.nextAt = next(selected, now); persist(current); return null;
      }
      var scheduledAt = id ? now : selected.nextAt;
      // Advance and save before any network or phone action; a crash cannot replay this occurrence.
      if (!id) selected.nextAt = next(selected, now);
      selected.lastRun = { status: 'running', scheduledAt: scheduledAt, startedAt: now, finishedAt: null, runId: null, trigger: id ? 'manual' : 'cron', error: null };
      persist(current); return clone(selected);
    });
  }
  function run(id) {
    var task = claim(id); if (!task) return null;
    var status = 'failed', error = null, summary = null;
    try {
      summary = execute(loadSnapshot(task), { scheduleId: task.id, scheduledAt: task.lastRun.scheduledAt, trigger: task.lastRun.trigger });
      if (!summary || ['completed', 'failed'].indexOf(summary.status) < 0) throw new Error('执行器没有返回有效结果，未自动重试');
      status = summary.status; error = summary.error;
    } catch (e) { status = e.code === 'BUSY' ? 'skipped_busy' : 'failed'; error = String(e.message || e).slice(0, 2000); }
    locked(function () {
      var current = state(), now = io.now();
      current.tasks.forEach(function (item) {
        if (item.id === task.id && item.revision === task.revision) { item.lastRun.status = status; item.lastRun.error = error; item.lastRun.runId = summary ? summary.id : null; item.lastRun.finishedAt = now; }
        if (item.enabled && item.nextAt <= now) { skip(item, item.id === task.id ? 'overlap' : 'busy', item.nextAt, now); item.nextAt = next(item, now); }
      }); persist(current);
    });
    return { id: task.id, status: status, error: error };
  }
  function enable(id, enabled) {
    if (typeof enabled !== 'boolean') throw new Error('启停状态无效');
    return locked(function () { var current = state(), task = find(current, id); if (enabled) loadSnapshot(task); task.enabled = enabled; task.nextAt = enabled ? next(task, io.now()) : null; persist(current); return publicTask(task); });
  }
  function remove(id) {
    return locked(function () { var current = state(), task = find(current, id); if (task.lastRun && task.lastRun.status === 'running') throw new Error('任务正在执行，请结束后再删除'); current.tasks = current.tasks.filter(function (item) { return item.id !== id; }); persist(current); try { io.removeTree(root + '/schedules/' + id); } catch (_) {} });
  }
  function reschedule(id, options) {
    if (!object(options) || typeof options.name !== 'string' || !options.name.trim() || options.name.length > 100 || /[\x00-\x1f\x7f]/.test(options.name)) throw new Error('定时任务名称无效');
    var nextAt = cron.next(options.cron, options.timezone, io.now(), io);
    return locked(function () {
      var current = state(), task = find(current, id);
      if (task.lastRun && task.lastRun.status === 'running') throw new Error('任务正在执行，请结束后再编辑');
      task.name = options.name.trim(); task.cron = options.cron.trim().replace(/\s+/g, ' '); task.timezone = options.timezone; task.nextAt = task.enabled ? nextAt : null; task.updatedAt = io.now(); persist(current); return publicTask(task);
    });
  }
  function pausePackage(source, packageId) {
    return locked(function () {
      var current = state(), retained = [];
      current.tasks.forEach(function (task) { if (origin(task.source) === origin(source) && task.scriptId === packageId) { task.enabled = false; task.nextAt = null; retained.push(task.cacheName); } });
      persist(current); return retained;
    });
  }
  return { save: save, recover: recover, tick: function () { return run(null); }, runNow: function (id) { if (!validId(id)) throw new Error('定时任务标识无效'); return run(id); }, enable: enable, remove: remove, reschedule: reschedule, pausePackage: pausePackage,
    list: function () { return locked(function () { return state().tasks.map(publicTask); }); },
    preview: function (expression, timezone) { var after = io.now(), values = []; for (var n = 0; n < 3; n++) { after = cron.next(expression, timezone, after, io); values.push(after); } return values; } };
}

module.exports = { create: create };
