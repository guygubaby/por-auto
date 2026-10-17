function launchMobileScripts(core, io, bundled) {
  if (!/^org\.autojs\.autojs6(?:\.|$)/.test(String(context.getPackageName()))) throw new Error('请使用官方 AutoJs6 运行启动器');
  if (!core.versionAtLeast(io.hostVersion, '6.7.0')) throw new Error('请先将 AutoJs6 更新到 6.7.0 或更新版本');
  var defaultSource = { url: 'https://github.com/guygubaby/por-auto', reference: 'main' };
  var settingsFile = io.root + '/settings.json';
  var settings = io.exists(settingsFile) ? JSON.parse(io.readText(settingsFile)) : { source: defaultSource };
  settings.source = core.source(settings.source);
  var manager = core.create(io, io.root, settings.source);
  var token = ''; // Private-repository credentials are never persisted or included in logs.

  function show(title, message) { dialogs.alert(title, String(message)); }
  function summary(result) {
    return '已更新：' + (result.updated.join('、') || '无') + '\n已是当前版本：' + (result.unchanged.join('、') || '无')
      + (result.errors.length ? '\n\n' + result.errors.map(function (item) { return item.id + '：' + item.message; }).join('\n') : '');
  }
  function select(items, title) {
    if (!items.length) { show('尚无脚本', '请先检查来源并安装脚本，或导入离线脚本包。'); return null; }
    var index = dialogs.select(title, items.map(function (p) { return p.name + ' · ' + p.version + ' (' + p.versionCode + ')'; }));
    return index < 0 ? null : items[index];
  }
  function readSecret() {
    var result = threads.disposable();
    var completed = false;
    var dialog = dialogs.build({ title: '私有仓库只读令牌', content: '只在本次启动器会话中使用，退出后清除。留空可清除当前令牌。', inputHint: 'GitHub Contents 只读令牌', inputPrefill: '', inputType: 129, inputSingleLine: true, positive: '确定', negative: '取消' });
    dialog.on('positive', function (d) { if (!completed) { completed = true; result.setAndNotify(String(d.getInputEditText().getText())); } });
    dialog.on('dismiss', function () { if (!completed) { completed = true; result.setAndNotify(null); } });
    dialog.show();
    return result.blockedGet();
  }
  if (manager.source.url === defaultSource.url && manager.source.reference === defaultSource.reference && !manager.list().installed.length) manager.importBundle(bundled);
  try {
    toast('正在检查手机脚本更新…');
    var initial = manager.check(token);
    if (initial.updated.length || initial.errors.length) show('脚本更新结果', summary(initial));
  } catch (error) { show('暂未取得更新', String(error.message || error) + '\n\n已安装的脚本仍可离线运行。私有仓库请设置令牌后重新检查。'); }

  while (true) {
    var choice = dialogs.select('Por Auto 手机脚本 · 启动器 v' + core.launcherVersion,
      ['运行已安装脚本', '安装来源中的脚本', '检查已安装脚本更新', '导入本地脚本包', '设置 GitHub 来源', '输入 / 清除私有仓库令牌', '导出运行日志', '退出']);
    if (choice < 0 || choice === 7) break;
    try {
      if (choice === 0) {
        var runPackage = select(manager.list().installed, '选择要运行的脚本');
        if (runPackage) {
          toast('正在运行：' + runPackage.name);
          var run = manager.run(runPackage.id);
          show(run.status === 'completed' ? '脚本运行完成' : '脚本运行失败', run.name + ' · v' + run.version + '\n' + (run.error || '日志已保存在本机。') + (run.error ? '\n请先核对手机状态，勿直接重跑发送任务。' : ''));
        }
      } else if (choice === 1) {
        manager.check(token);
        var installPackage = select(manager.list().available, '选择安装 / 更新的脚本');
        if (installPackage && dialogs.confirm('安装手机脚本', installPackage.description + '\n\n来源：' + manager.source.url + '\n仅安装你信任的脚本；运行时脚本拥有 AutoJs6 的权限。')) {
          show('安装结果', manager.install(installPackage.id, token) ? '脚本已校验并安装，下次运行使用此版本。' : '已经安装相同版本。');
        }
      } else if (choice === 2) {
        show('检查更新结果', summary(manager.check(token)));
      } else if (choice === 3) {
        var importPath = dialogs.rawInput('本地脚本包 JSON 路径', files.path('./PorAuto-mobile-scripts.json'));
        if (importPath && dialogs.confirm('导入本地脚本包', '请确认此文件来自你信任的发布者。SHA-256 校验可检测文件损坏，不代表脚本行为安全。')) show('导入结果', summary(manager.importBundle(io.importFile(String(importPath)))));
      } else if (choice === 4) {
        var url = dialogs.rawInput('GitHub 仓库根地址', manager.source.url);
        if (!url) continue;
        var reference = dialogs.rawInput('分支或标签', manager.source.reference);
        if (!reference) continue;
        var next = core.source({ url: String(url).trim(), reference: String(reference).trim() });
        io.writeAtomic(settingsFile, JSON.stringify({ source: next }, null, 2));
        settings.source = next; token = ''; manager = core.create(io, io.root, next);
        show('来源已保存', '旧来源的脚本、配置和日志仍保留；新来源需要检查后选择安装脚本。');
      } else if (choice === 5) {
        var secret = readSecret();
        if (secret !== null) { token = String(secret).trim(); show('令牌设置', token ? '本次会话已设置令牌，退出后清除。' : '已清除令牌。'); }
      } else if (choice === 6) {
        var exported = io.exportFile(manager.exportLogs());
        show('日志已导出', exported + '\n\n包含脚本版本和日志，不包含仓库令牌。');
        app.viewFile(exported);
      }
    } catch (error) { show('操作未完成', String(error.message || error)); }
  }
  token = '';
}
