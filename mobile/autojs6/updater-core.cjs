'use strict';

var LAUNCHER_VERSION = 2;
var MAX_FILE = 2 * 1024 * 1024;
var MAX_PACKAGE = 10 * 1024 * 1024;
var MAX_CATALOG = 256 * 1024;
var MAX_RESULT = 2 * 1024 * 1024;

function fail(message) { throw new Error(message); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function integer(value, min, max) { return typeof value === 'number' && value % 1 === 0 && value >= min && value <= max; }
function id(value) { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value) && !/^(?:__proto__|prototype|constructor)$/.test(value); }
function relative(value) {
  if (typeof value !== 'string' || value.length > 180 || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(value)) fail('脚本文件路径无效');
  var parts = value.split('/');
  for (var i = 0; i < parts.length; i++) {
    if (!parts[i] || parts[i] === '.' || parts[i] === '..' || /[. ]$/.test(parts[i]) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(parts[i])) fail('脚本文件路径无效');
  }
  return value;
}
function version(value) { return typeof value === 'string' && /^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(value); }
function versionAtLeast(actual, minimum) {
  if (!version(actual) || !version(minimum)) return false;
  var a = actual.split('.'); var b = minimum.split('.');
  for (var i = 0; i < 3; i++) { if (+a[i] !== +b[i]) return +a[i] > +b[i]; }
  return true;
}
function source(value) {
  if (!object(value)) fail('GitHub 来源配置无效');
  var match = /^https:\/\/github\.com\/([a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,99})\/([a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,99})\/?$/.exec(String(value.url || ''));
  var ref = value.reference || 'main';
  if (!match || typeof ref !== 'string' || !/^[a-zA-Z0-9_./-]{1,160}$/.test(ref) || /(^|\/)\.\.?($|\/)|\/\//.test(ref)) fail('请填写 GitHub 仓库根地址及有效分支');
  var repo = match[2].replace(/\.git$/, '');
  return { url: 'https://github.com/' + match[1] + '/' + repo, owner: match[1], repo: repo, reference: ref };
}
function catalog(value) {
  if (!object(value) || value.schemaVersion !== 1 || !Array.isArray(value.workflows) || value.workflows.length < 1 || value.workflows.length > 32) fail('手机脚本目录格式或数量无效');
  var ids = [];
  var workflows = value.workflows.map(function (p) {
    if (!object(p) || !id(p.id) || ids.indexOf(p.id.toLowerCase()) >= 0 || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 100 || !version(p.version) || !integer(p.versionCode, 1, 2147483647)) fail('脚本标识、名称或版本无效');
    ids.push(p.id.toLowerCase());
    var entry = relative(p.entry);
    var minLauncher = p.minLauncher === undefined ? 1 : p.minLauncher;
    var minAutoJs6 = p.minAutoJs6 || '6.7.0';
    if (!/\.js$/.test(entry) || !integer(minLauncher, 1, 9999) || !version(minAutoJs6) || !Array.isArray(p.files) || !p.files.length || p.files.length > 128) fail('脚本入口、运行环境或文件清单无效');
    var paths = []; var total = 0;
    var files = p.files.map(function (f) {
      if (!object(f) || !integer(f.size, 0, MAX_FILE) || typeof f.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(f.sha256)) fail('脚本文件摘要或大小无效');
      var path = relative(f.path);
      if (paths.indexOf(path.toLowerCase()) >= 0) fail('脚本文件路径重复');
      paths.push(path.toLowerCase()); total += f.size;
      return { path: path, size: f.size, sha256: f.sha256 };
    }).sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
    for (var i = 0; i < paths.length; i++) {
      for (var j = 0; j < paths.length; j++) {
        if (i !== j && paths[j].indexOf(paths[i] + '/') === 0) fail('脚本文件与目录路径冲突');
      }
    }
    if (total > MAX_PACKAGE || !files.some(function (f) { return f.path === entry; })) fail('脚本包过大或缺少入口文件');
    return { id: p.id, name: p.name, description: typeof p.description === 'string' ? p.description.slice(0, 2000) : '', version: p.version, versionCode: p.versionCode, minLauncher: minLauncher, minAutoJs6: minAutoJs6, entry: entry, files: files };
  });
  return { schemaVersion: 1, name: String(value.name || '手机脚本'), workflows: workflows };
}

function storeItems(value) {
  var ids = [];
  return value.available.concat(value.installed).filter(function (p) {
    if (ids.indexOf(p.id) >= 0) return false;
    ids.push(p.id); return true;
  }).map(function (p) {
    var installed = value.installed.filter(function (item) { return item.id === p.id; })[0] || null;
    var available = value.available.filter(function (item) { return item.id === p.id; })[0] || null;
    return { id: p.id, name: p.name, description: p.description, installed: installed, available: available,
      update: !!(installed && available && available.versionCode > installed.versionCode) };
  });
}

function create(io, root, inputSource) {
  var origin = source(inputSource);
  var key = io.sha256(io.encode(origin.url + '\n' + origin.reference));
  var store = root + '/sources/' + key;
  var stateFile = store + '/state.json';
  var cacheFile = store + '/catalog.json';
  io.mkdir(store + '/versions');
  io.mkdir(root + '/runs');

  function locked(action) { return io.withLock(root + '/operation.lock', action); }
  function readJson(file, fallback) {
    if (!io.exists(file)) return fallback;
    try { return JSON.parse(io.readText(file)); } catch (_) { fail('本地配置无法读取，已保留原文件：' + file); }
  }
  function writeJson(file, value) { io.writeAtomic(file, JSON.stringify(value, null, 2) + '\n'); }
  function trimHistory(limit) {
    var folders = io.list(root + '/runs').filter(function (name) { return /^\d+-[a-f0-9-]+$/.test(name); }).sort(function (a, b) { return Number(b.split('-')[0]) - Number(a.split('-')[0]) || (a < b ? 1 : a > b ? -1 : 0); });
    folders.slice(limit).forEach(function (name) { io.removeTree(root + '/runs/' + name); });
    return folders.slice(0, limit);
  }
  function state() {
    var value = readJson(stateFile, { schemaVersion: 1, installed: [] });
    if (!object(value) || value.schemaVersion !== 1 || !Array.isArray(value.installed) || value.installed.length > 32) fail('本地脚本状态损坏，已保留原文件');
    if (value.installed.length) value.installed = catalog({ schemaVersion: 1, workflows: value.installed }).workflows;
    return value;
  }
  function digest(p) { return io.sha256(io.encode(JSON.stringify({ id: p.id, version: p.version, versionCode: p.versionCode, entry: p.entry, minLauncher: p.minLauncher, minAutoJs6: p.minAutoJs6, files: p.files }))); }
  function directory(p) { return store + '/versions/' + p.id + '-' + p.versionCode + '-' + digest(p); }
  function compatible(p) {
    if (p.minLauncher > LAUNCHER_VERSION) fail('此脚本需要新版启动器，请重新导入最新启动器');
    if (!versionAtLeast(io.hostVersion, p.minAutoJs6)) fail('此脚本需要 AutoJs6 ' + p.minAutoJs6 + ' 或更新版本');
  }
  function checkedBytes(p, file, bytes) {
    if (bytes.length !== file.size || io.sha256(bytes) !== file.sha256) fail('脚本完整性校验失败：' + p.name + ' / ' + file.path);
    return bytes;
  }
  function verifyInstalled(p) {
    p.files.forEach(function (file) { checkedBytes(p, file, io.readBytes(directory(p) + '/' + file.path)); });
  }
  function install(p, readFile) {
    compatible(p);
    var current = state();
    if (current.installed.some(function (item) { return item.id !== p.id && item.id.toLowerCase() === p.id.toLowerCase(); })) fail('脚本 ID 的大小写与已安装脚本冲突');
    var previous = current.installed.filter(function (item) { return item.id === p.id; })[0];
    if (!previous && current.installed.length >= 32) fail('每个来源最多安装 32 个脚本');
    if (previous && p.versionCode < previous.versionCode) fail('拒绝降级脚本：' + p.name);
    if (previous && p.versionCode === previous.versionCode && digest(p) !== digest(previous)) fail('脚本内容已改变但 versionCode 未递增：' + p.name);
    if (previous && digest(p) === digest(previous)) {
      try { verifyInstalled(previous); return false; } catch (_) { /* Repair a damaged installed copy from verified source bytes. */ }
    }
    var stage = store + '/versions/staging-' + io.uuid();
    io.mkdir(stage);
    try {
      p.files.forEach(function (file) {
        var bytes = checkedBytes(p, file, readFile(p, file));
        io.writeBytes(stage + '/' + file.path, bytes);
      });
      var destination = directory(p);
      if (io.exists(destination)) {
        try { verifyInstalled(p); io.removeTree(stage); stage = null; }
        catch (_) { io.rename(destination, store + '/versions/damaged-' + io.uuid()); }
      }
      if (stage) { io.rename(stage, destination); stage = null; }
      current.installed = current.installed.filter(function (item) { return item.id !== p.id; });
      current.installed.push(p);
      writeJson(stateFile, current);
      return true;
    } finally { if (stage && io.exists(stage)) io.removeTree(stage); }
  }
  function api(rest) { return 'https://api.github.com/repos/' + encodeURIComponent(origin.owner) + '/' + encodeURIComponent(origin.repo) + '/' + rest; }
  function requestJson(url, token) {
    var bytes = io.request(url, token || '', MAX_CATALOG);
    try { return JSON.parse(io.decode(bytes)); } catch (_) { fail('GitHub 返回的脚本目录不是有效 JSON'); }
  }
  function refresh(token) {
    // Listing one commit omits the potentially large file diffs returned by the single-commit endpoint.
    var commits = requestJson(api('commits?sha=' + encodeURIComponent(origin.reference) + '&per_page=1'), token);
    var commit = Array.isArray(commits) && commits.length === 1 ? commits[0].sha : null;
    if (typeof commit !== 'string' || !/^[a-f0-9]{40}$/.test(commit)) fail('GitHub 提交标识无效');
    var url = api('contents/mobile-workflows/registry.json?ref=' + commit);
    var value = catalog(requestJson(url, token));
    writeJson(cacheFile, { commit: commit, catalog: value });
    return { commit: commit, catalog: value };
  }
  function onlineReader(commit, token) {
    return function (p, file) {
      var path = ('mobile-workflows/' + p.id + '/src/' + file.path).split('/').map(encodeURIComponent).join('/');
      return io.request(api('contents/' + path + '?ref=' + commit), token || '', MAX_FILE);
    };
  }
  function check(token) {
    return locked(function () {
      var snapshot = refresh(token);
      var installed = state().installed;
      var result = { commit: snapshot.commit, updated: [], unchanged: [], errors: [] };
      installed.forEach(function (old) {
        var next = snapshot.catalog.workflows.filter(function (p) { return p.id === old.id; })[0];
        if (!next) return;
        try { (install(next, onlineReader(snapshot.commit, token)) ? result.updated : result.unchanged).push(next.name); }
        catch (error) { result.errors.push({ id: old.id, message: String(error.message || error) }); }
      });
      return result;
    });
  }
  function installOnline(packageId, token) {
    return locked(function () {
      var snapshot = refresh(token);
      var p = snapshot.catalog.workflows.filter(function (item) { return item.id === packageId; })[0];
      if (!p) fail('GitHub 目录中找不到此脚本');
      return install(p, onlineReader(snapshot.commit, token));
    });
  }
  function uninstall(packageId) {
    if (!id(packageId)) fail('脚本标识无效');
    return locked(function () {
      var current = state();
      if (!current.installed.some(function (p) { return p.id === packageId; })) return { removed: false, warning: null };
      var retained = io.scheduling ? io.scheduling.pausePackage(origin, packageId) : [];
      current.installed = current.installed.filter(function (p) { return p.id !== packageId; });
      writeJson(stateFile, current);
      try {
        var pattern = new RegExp('^' + packageId + '-[0-9]+-[a-f0-9]{64}$');
        io.list(store + '/versions').filter(function (name) { return pattern.test(name) && retained.indexOf(name) < 0; }).forEach(function (name) { io.removeTree(store + '/versions/' + name); });
        return { removed: true, warning: null };
      } catch (_) { return { removed: true, warning: '工作流已移除，部分缓存未能清理；配置与日志仍保留。' }; }
    });
  }
  function importBundle(bundle) {
    return locked(function () {
      if (!object(bundle) || bundle.schemaVersion !== 1 || !Array.isArray(bundle.files) || bundle.files.length > 4096) fail('离线脚本包格式无效');
      var value = catalog(bundle.catalog);
      var contents = Object.create(null);
      var expected = 0; var total = 0;
      bundle.files.forEach(function (f) {
        if (!object(f) || !id(f.id) || typeof f.base64 !== 'string' || f.base64.length > Math.ceil(MAX_FILE / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(f.base64)) fail('离线脚本数据无效');
        var fileKey = f.id + '/' + relative(f.path);
        if (contents[fileKey] !== undefined) fail('离线脚本文件重复');
        contents[fileKey] = f.base64;
      });
      value.workflows.forEach(function (p) { expected += p.files.length; p.files.forEach(function (f) { total += f.size; }); });
      if (total > MAX_PACKAGE) fail('离线脚本包总大小不能超过 10 MiB');
      if (expected !== bundle.files.length) fail('离线脚本包的文件数量不匹配');
      // Validate every byte before installing any package, so a bad bundle changes no pointers.
      value.workflows.forEach(function (p) {
        p.files.forEach(function (f) {
          var content = contents[p.id + '/' + f.path];
          if (content === undefined) fail('离线脚本包缺少文件');
          checkedBytes(p, f, io.base64(content));
        });
      });
      var result = { updated: [], unchanged: [], errors: [] };
      value.workflows.forEach(function (p) {
        try { (install(p, function (item, f) { return io.base64(contents[item.id + '/' + f.path]); }) ? result.updated : result.unchanged).push(p.name); }
        catch (error) { result.errors.push({ id: p.id, message: String(error.message || error) }); }
      });
      writeJson(cacheFile, { commit: 'offline', catalog: value });
      return result;
    });
  }
  function run(packageId, pinned, trigger) {
    return locked(function () {
      var p = state().installed.filter(function (item) { return item.id === packageId; })[0];
      if (!p) fail('请先安装脚本');
      if (pinned) {
        if (source(pinned.source).url !== origin.url || source(pinned.source).reference !== origin.reference || !pinned.config || typeof pinned.config !== 'object' || Array.isArray(pinned.config)
            || !object(pinned.execution) || !id(pinned.execution.workflowId) || typeof pinned.execution.dryRun !== 'boolean') fail('定时任务配置快照无效');
        p = catalog({ schemaVersion: 1, workflows: [pinned.package] }).workflows[0];
        if (p.id !== packageId || pinned.cacheName !== p.id + '-' + p.versionCode + '-' + digest(p)) fail('定时任务代码快照无效');
      }
      compatible(p); verifyInstalled(p);
      trimHistory(199);
      var runId = String(io.now()) + '-' + io.uuid();
      var folder = root + '/runs/' + runId;
      io.mkdir(folder);
      var summary = { id: runId, scriptId: p.id, name: p.name, version: p.version, versionCode: p.versionCode, packageSha256: digest(p), source: origin.url, reference: origin.reference, timestamp: io.now(), status: 'running', error: null };
      if (trigger) { summary.scheduleId = trigger.scheduleId; summary.scheduledAt = trigger.scheduledAt; summary.trigger = trigger.trigger; }
      writeJson(folder + '/summary.json', summary);
      var configFile = store + '/config/' + p.id + '.json';
      var events = [];
      function log(message, details) {
        var encoded = details === undefined ? 'null' : JSON.stringify(details);
        if (encoded === undefined) encoded = 'null';
        var detail = encoded.length > 2000 ? { truncated: encoded.slice(0, 2000) } : JSON.parse(encoded);
        events.push(JSON.stringify({ timestamp: io.now(), message: String(message).slice(0, 1000), details: detail }));
        if (events.length > 32) events.shift();
      }
      try {
        log('开始运行脚本');
        var entry = io.load(directory(p) + '/' + p.entry);
        if (typeof entry !== 'function') fail('脚本入口必须导出函数：module.exports = function (por) { ... }');
        io.mkdir(store + '/data/' + p.id);
        // shortcut: entry functions must join their workers before returning; isolated async engines need separate lifecycle tracking.
        var result = entry({ id: p.id, version: p.version, versionCode: p.versionCode, runId: runId, dataDir: store + '/data/' + p.id,
          execution: pinned ? JSON.parse(JSON.stringify(pinned.execution)) : null,
          screenSession: io.screenSession && io.screenSession.isActive() ? io.screenSession : null,
          schedules: !pinned && io.scheduling ? {
            timezone: io.localTimezone(), preview: io.scheduling.preview, formatTime: io.formatTime,
            save: function (options, execution) {
              return io.scheduling.save(options, { source: origin, package: p, cacheName: p.id + '-' + p.versionCode + '-' + digest(p), config: readJson(configFile, {}), execution: execution });
            }
          } : null,
          readConfig: function () { return pinned ? JSON.parse(JSON.stringify(pinned.config)) : readJson(configFile, {}); },
          saveConfig: function (value) { if (pinned) fail('定时运行不能修改固定配置'); if (!object(value)) fail('配置必须是 JSON 对象'); writeJson(configFile, value); },
          recordResult: function (value) {
            if (!object(value)) fail('运行结果必须是 JSON 对象');
            var text = JSON.stringify(value, null, 2);
            if (!object(JSON.parse(text)) || io.encode(text).length > MAX_RESULT) fail('运行结果无效或超过 2 MiB');
            io.writeAtomic(folder + '/result.json', text + '\n');
          },
          readLastResult: function () {
            var folders = trimHistory(200);
            for (var n = 0; n < folders.length; n++) {
              if (folders[n] === runId) continue;
              var previous = root + '/runs/' + folders[n], info = readJson(previous + '/summary.json', null);
              if (info && info.scriptId === p.id && info.source === origin.url && info.reference === origin.reference && io.exists(previous + '/result.json')) return readJson(previous + '/result.json', null);
            }
            return null;
          },
          log: log });
        if (result && typeof result.then === 'function') fail('脚本入口必须同步完成，不能返回 Promise');
        summary.status = 'completed'; log('脚本运行完成');
      } catch (error) {
        summary.status = 'failed'; summary.error = String(error.message || error).slice(0, 2000);
        log('脚本运行失败，未自动重试', { error: summary.error });
      } finally {
        summary.finishedAt = io.now(); writeJson(folder + '/summary.json', summary);
        if (summary.status === 'failed') {
          try { io.writeAtomic(folder + '/events.jsonl', events.join('\n') + '\n'); }
          catch (_) { summary.warning = '诊断日志未能保存'; writeJson(folder + '/summary.json', summary); }
        }
      }
      return summary;
    });
  }
  function list() {
    var current = state().installed;
    var cached = readJson(cacheFile, null);
    return { installed: current, available: cached ? catalog(cached.catalog).workflows : [] };
  }
  function exportLogs() {
    return locked(function () {
      var folders = trimHistory(200).slice(0, 10);
      return { schemaVersion: 1, launcherVersion: LAUNCHER_VERSION, exportedAt: io.now(), records: folders.map(function (name) {
        var folder = root + '/runs/' + name;
        var summary = readJson(folder + '/summary.json', null);
        if (summary && summary.status === 'running') { summary.status = 'interrupted'; summary.error = '上次运行未完成或宿主被停止，未自动重试'; }
        var result = readJson(folder + '/result.json', null);
        if (summary && ['failed', 'interrupted'].indexOf(summary.status) >= 0 && object(result) && result.status === 'running') {
          result.status = summary.status; result.error = summary.error;
        }
        return { summary: summary, result: result, events: io.exists(folder + '/events.jsonl') ? io.readText(folder + '/events.jsonl') : '' };
      }) };
    });
  }
  return { refresh: function (token) { return locked(function () { return refresh(token); }); }, check: check, install: installOnline, uninstall: uninstall, importBundle: importBundle,
    run: function (id) { return run(id); }, runPinned: function (snapshot, trigger) { return run(snapshot.package.id, snapshot, trigger); }, list: list, exportLogs: exportLogs, source: origin };
}

module.exports = { create: create, catalog: catalog, storeItems: storeItems, source: source, relative: relative, versionAtLeast: versionAtLeast, launcherVersion: LAUNCHER_VERSION, limits: { file: MAX_FILE, package: MAX_PACKAGE, catalog: MAX_CATALOG } };
