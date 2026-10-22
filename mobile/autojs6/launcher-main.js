function launchMobileScripts(core, io, bundled, schedulerCore, cron) {
  if (!/^org\.autojs\.autojs6(?:\.|$)/.test(String(context.getPackageName()))) throw new Error('请使用官方 AutoJs6 运行启动器');
  if (!core.versionAtLeast(io.hostVersion, '6.7.0')) throw new Error('请先将 AutoJs6 更新到 6.7.0 或更新版本');
  var defaultSource = { url: 'https://github.com/guygubaby/por-auto', reference: 'main' };
  var settingsFile = io.root + '/settings.json';
  var settings = io.exists(settingsFile) ? JSON.parse(io.readText(settingsFile)) : { source: defaultSource };
  settings.source = core.source(settings.source || defaultSource);
  var manager = core.create(io, io.root, settings.source);
  var scheduler = schedulerCore.create(io, io.root, core, cron, function (snapshot, trigger) { return core.create(io, io.root, snapshot.source).runPinned(snapshot, trigger); });
  io.scheduling = scheduler;
  var timerThread = null, timerStop = null;
  function timerRunning() { return timerThread !== null && timerThread.isAlive(); }
  var token = ''; // Repository credentials remain in memory for this launcher session only.
  var state = { installed: [], available: [] }, filter = 'all', busy = false, closed = false;
  var green = '#75D9AE', muted = '#A5B9AE', background = '#101A15';
  function styleButton(view, active) {
    view.setAllCaps(false); view.setElevation(0);
    view.setBackgroundTintList(android.content.res.ColorStateList.valueOf(colors.parseColor(active ? '#284C3B' : '#1A2921')));
    view.setTextColor(colors.parseColor(active ? green : muted)); view.setAlpha(busy ? .55 : 1);
  }

  ui.layout('<vertical bg="#101A15" padding="16 12">'
    + '<horizontal gravity="center_vertical"><text text="Por Auto" textColor="#75D9AE" textSize="13sp" layout_weight="1"/><button id="more" text="更多" w="64" h="48" textSize="13sp" textColor="#EFF5F1"/></horizontal>'
    + '<text text="手机工作流商店" textSize="21sp" textStyle="bold" textColor="#EFF5F1" margin="0 4 0 4"/>'
    + '<text text="从你的仓库安装工作流，配置与记录留在本机" textSize="12sp" textColor="#A5B9AE" marginBottom="12"/>'
    + '<text id="timerStatus" text="手机定时：未开启" textSize="12sp" textColor="#A5B9AE" marginBottom="8"/>'
    + '<card cardCornerRadius="10dp" cardElevation="0dp" cardBackgroundColor="#1A2921"><vertical padding="12">'
    + '<text text="工作流来源" textSize="11sp" textColor="#A5B9AE"/><text id="source" textSize="13sp" textColor="#EFF5F1" maxLines="2"/>'
    + '<horizontal><button id="sourceSettings" text="来源设置" w="0" h="48" layout_weight="1" textSize="13sp" textColor="#EFF5F1"/><button id="refresh" text="刷新目录" w="0" h="48" layout_weight="1" textSize="13sp" textColor="#75D9AE"/></horizontal>'
    + '</vertical></card>'
    + '<input id="query" hint="搜索工作流" textSize="13sp" textColor="#EFF5F1" textColorHint="#A5B9AE" singleLine="true" h="48" marginTop="8"/>'
    + '<horizontal><button id="all" text="全部" w="0" h="48" layout_weight="1" textSize="12sp"/><button id="installed" text="已安装" w="0" h="48" layout_weight="1" textSize="12sp"/><button id="updates" text="可更新" w="0" h="48" layout_weight="1" textSize="12sp"/></horizontal>'
    + '<horizontal gravity="center_vertical"><text id="status" textSize="12sp" textColor="#A5B9AE" w="0" layout_weight="1" padding="0 8" maxLines="3" ellipsize="end"/><button id="updateAll" text="全部更新" h="48" textSize="12sp" textColor="#75D9AE" visibility="gone"/></horizontal>'
    + '<scroll h="0" layout_weight="1"><vertical id="cards"/></scroll>'
    + '<text text="工作流更新无需重装 AutoJs6 或电脑软件" textSize="11sp" textColor="#A5B9AE" padding="0 8"/>'
    + '</vertical>');
  ui.statusBarColor(background); ui.navigationBarColor(background);
  ui.statusBarIconLight(true); ui.navigationBarIconLight(true);

  function show(title, message) { dialogs.alert(title, String(message)); }
  function summary(result) {
    return '已更新：' + (result.updated.join('、') || '无') + '\n已是当前版本：' + (result.unchanged.join('、') || '无')
      + (result.errors.length ? '\n\n' + result.errors.map(function (item) { return item.id + '：' + item.message; }).join('\n') : '');
  }
  function readSecret() {
    var result = threads.disposable(), completed = false;
    var dialog = dialogs.build({ title: '私有仓库只读令牌', content: '只在本次使用期间保留，退出后清除。留空可清除当前令牌。', inputHint: 'GitHub Contents 只读令牌', inputPrefill: '', inputType: 129, inputSingleLine: true, positive: '确定', negative: '取消' });
    dialog.on('positive', function (d) { if (!completed) { completed = true; result.setAndNotify(String(d.getInputEditText().getText())); } });
    dialog.on('dismiss', function () { if (!completed) { completed = true; result.setAndNotify(null); } });
    dialog.show(); return result.blockedGet();
  }
  function version(p) { return 'v' + p.version + ' · ' + p.versionCode; }
  function startTimer() {
    if (timerRunning()) return '手机定时执行已开启';
    if (!dialogs.confirm('开启手机定时执行', '当前任务使用原生无障碍控件，无需截图授权。保持手机唤醒，请保持解锁。\n\n离开当前页面后仍可执行；关闭脚本、重启或系统停止宿主后，需要重新开启。错过的时间不补跑，失败不自动重发。')) return '已取消开启';
    var ready = threads.disposable(); timerStop = new java.util.concurrent.atomic.AtomicBoolean(false);
    timerThread = threads.start(function () {
      var notified = false, failure = null;
      try {
        io.withLock(io.root + '/scheduler-session.lock', function () {
          io.withLock(io.root + '/operation.lock', function () { io.screenSession.acquire(false); scheduler.recover(); });
          ready.setAndNotify(null); notified = true;
          ui.run(function () { if (!closed) { ui.timerStatus.setText('手机定时：执行会话已开启'); ui.timerStatus.attr('textColor', green); } });
          while (!timerStop.get()) {
            io.screenSession.check();
            var result = scheduler.tick();
            if (result) ui.run(function () { if (!closed) ui.timerStatus.setText('手机定时：' + (result.status === 'completed' ? '上一轮完成' : result.status === 'skipped_busy' ? '操作占用，已跳过本轮' : '上一轮未完成，请查看记录')); });
            sleep(1000);
          }
        });
      } catch (e) { failure = String(e.message || e); if (!notified) { ready.setAndNotify(failure); notified = true; } }
      finally {
        // Manual runs may share this engine's projection; let them finish before releasing it.
        while (io.screenSession.isActive()) {
          try { io.withLock(io.root + '/operation.lock', function () { io.screenSession.release(); }); }
          catch (e) { if (e.code !== 'BUSY') { failure = failure || String(e.message || e); break; } sleep(250); }
        }
        ui.run(function () { if (!closed) { ui.timerStatus.setText(failure ? '手机定时已停止：' + failure : '手机定时：已停止后续执行'); ui.timerStatus.attr('textColor', failure ? '#FFB4A8' : muted); } });
      }
    });
    var error = ready.blockedGet(); if (error) throw new Error(error);
    return '手机定时执行已开启，可在「更多」查看任务或停止后续执行';
  }
  function manageSchedules() {
    var tasks = scheduler.list();
    if (!tasks.length) { show('暂无定时任务', '在工作流卡片「运行 / 配置 → 新建定时任务」保存任务。'); return; }
    var index = dialogs.select('手机定时任务', tasks.map(function (task) { return (task.enabled ? '已启用 · ' : '已暂停 · ') + task.name; }));
    if (index < 0) return;
    var task = tasks[index];
    var action = dialogs.select(task.name, ['查看详情和结果', '修改名称和时间', task.enabled ? '暂停后续执行' : '启用后续执行', '立即执行一次', '删除任务']);
    if (action === 0) {
      var labels = { completed: '完成', failed: '失败', running: '正在执行', interrupted: '上轮中断', skipped_busy: '操作占用，已跳过', missed: '错过时间，未补跑', overlap: '上一轮未结束，已跳过', busy: '手机正在处理其他任务，已跳过' };
      show(task.name, task.scriptName + ' · v' + task.version + ' (' + task.versionCode + ')' + '\n' + (task.dryRun ? '预演，不发送' : '正式发送')
        + '\n' + task.cron + ' · ' + task.timezone + '\n下次：' + (task.nextAt === null ? '已暂停' : io.formatTime(task.nextAt, task.timezone))
        + '\n上次：' + (task.lastRun ? labels[task.lastRun.status] || task.lastRun.status : '尚未执行') + (task.lastRun && task.lastRun.error ? '\n' + task.lastRun.error : '')
        + (task.lastSkip ? '\n最近跳过：' + (labels[task.lastSkip.status] || task.lastSkip.status) + '\n' + io.formatTime(task.lastSkip.at, task.timezone) : '')
        + '\n\n代码与业务配置使用保存时的快照。运行日志可从「更多」导出。');
    } else if (action === 1) {
      var name = dialogs.rawInput('任务名称', task.name); if (name === null) return;
      var expression = dialogs.rawInput('Cron：分 时 日 月 周', task.cron); if (expression === null) return;
      var timezone = dialogs.rawInput('IANA 时区', task.timezone); if (timezone === null) return;
      var upcoming = scheduler.preview(String(expression).trim(), String(timezone).trim());
      if (dialogs.confirm('修改执行时间', upcoming.map(function (at) { return io.formatTime(at, String(timezone).trim()); }).join('\n') + '\n\n消息、接收对象和代码版本仍保持原快照。')) scheduler.reschedule(task.id, { name: String(name), cron: String(expression).trim(), timezone: String(timezone).trim() });
    } else if (action === 2) scheduler.enable(task.id, !task.enabled);
    else if (action === 3) {
      if (!timerRunning() || timerStop.get()) throw new Error('请先从「更多」开启手机定时执行，完成本次截图授权');
      if (!dialogs.confirm('立即执行一次', task.name + '\n' + (task.dryRun ? '预演，不点击发送' : '正式发送，每个目标发送一次') + '\n\n使用保存时的消息和接收配置，不改变之后的计划时间。')) return;
      var result = scheduler.runNow(task.id); if (result.status !== 'completed') throw new Error(result.error || '任务未完成，请查看运行记录');
    } else if (action === 4 && dialogs.confirm('删除定时任务', task.name + '\n任务配置会删除，已有运行记录保留。')) scheduler.remove(task.id);
  }
  function render() {
    ui.source.setText(manager.source.owner + '/' + manager.source.repo + ' · ' + manager.source.reference + (token ? ' · 已设置令牌' : ''));
    var items = core.storeItems(state), count = items.filter(function (item) { return item.update; }).length;
    ui.all.setText('全部 ' + items.length); ui.installed.setText('已安装 ' + state.installed.length); ui.updates.setText('可更新 ' + count);
    ['all', 'installed', 'updates'].forEach(function (name) { styleButton(ui[name], filter === name); ui[name].setEnabled(!busy); });
    ['more', 'sourceSettings', 'refresh', 'updateAll'].forEach(function (name) { styleButton(ui[name], name === 'refresh' || name === 'updateAll'); ui[name].setEnabled(!busy); });
    ui.updateAll.setVisibility(count ? android.view.View.VISIBLE : android.view.View.GONE);
    ui.cards.removeAllViews();
    var query = String(ui.query.text()).trim().toLowerCase();
    items = items.filter(function (item) {
      return (filter !== 'installed' || item.installed) && (filter !== 'updates' || item.update)
        && (!query || (item.name + ' ' + item.description).toLowerCase().indexOf(query) >= 0);
    });
    if (!items.length) {
      var empty = ui.inflate('<text textColor="#A5B9AE" textSize="13sp" padding="12 24"/>', ui.cards, false);
      empty.setText(query ? '没有匹配的工作流' : filter === 'updates' ? '已安装的工作流暂无更新' : filter === 'installed' ? '还没有安装工作流' : '目录暂时为空，请刷新或导入工作流包');
      ui.cards.addView(empty);
    }
    items.forEach(function (item) {
      var card = ui.inflate('<card w="*" margin="0 0 0 10" cardCornerRadius="10dp" cardElevation="0dp" cardBackgroundColor="#1A2921"><vertical padding="12">'
        + '<text id="title" textSize="15sp" textStyle="bold" textColor="#EFF5F1"/>'
        + '<text id="version" textSize="11sp" textColor="#75D9AE" margin="0 4 0 6"/>'
        + '<text id="description" textSize="12sp" textColor="#A5B9AE"/>'
        + '<horizontal marginTop="6"><button id="primary" w="0" h="48" layout_weight="1" textSize="13sp" textColor="#75D9AE"/>'
        + '<button id="update" text="更新" w="0" h="48" layout_weight="1" textSize="13sp" textColor="#75D9AE"/>'
        + '<button id="remove" text="删除" w="0" h="48" layout_weight="1" textSize="13sp" textColor="#A5B9AE"/></horizontal>'
        + '</vertical></card>', ui.cards, false);
      card.title.setText(item.name); card.description.setText(item.description);
      card.version.setText(item.installed ? '已安装 ' + version(item.installed) + (item.update ? ' → ' + version(item.available) : '') : '可安装 ' + version(item.available));
      card.primary.setText(item.installed ? '运行 / 配置' : '安装');
      card.update.setVisibility(item.update ? android.view.View.VISIBLE : android.view.View.GONE);
      card.remove.setVisibility(item.installed ? android.view.View.VISIBLE : android.view.View.GONE);
      [card.primary, card.update, card.remove].forEach(function (button, index) { styleButton(button, index < 2); button.setEnabled(!busy); });
      card.primary.on('click', function () {
        if (!item.installed) return install(item);
        perform('正在运行：' + item.name, function () {
          var result = manager.run(item.id);
          if (result.status !== 'completed') throw new Error(result.error + '\n请先核对运行记录，勿直接重跑发送任务。');
          return '运行已结束，记录已保存在本机';
        });
      });
      card.update.on('click', function () { install(item); });
      card.remove.on('click', function () {
        perform('移除工作流…', function () {
          if (!dialogs.confirm('删除工作流', item.name + '\n\n配置与运行记录会保留，之后可以重新安装。')) return '已取消删除';
          var removed = manager.uninstall(item.id);
          return removed.warning || '工作流已删除，相关定时任务已暂停，配置与记录保留';
        });
      });
      ui.cards.addView(card);
    });
  }
  function perform(label, action) {
    if (busy || closed) return;
    busy = true; ui.status.attr('textColor', muted); ui.status.setText(label); render();
    threads.start(function () {
      var message = '', failed = false, next = state;
      try { message = action() || '操作已完成'; next = manager.list(); }
      catch (error) {
        failed = true; message = String(error.message || error);
        if (token) message = message.split(token).join('[redacted]');
        try { next = manager.list(); } catch (_) {}
      }
      if (closed) return;
      ui.run(function () {
        state = next; busy = false;
        ui.status.attr('textColor', failed ? '#FFB4A8' : muted); ui.status.setText(message); render();
      });
      if (failed) show('操作未完成', message);
    });
  }
  function install(item) {
    perform(item.installed ? '正在更新工作流…' : '正在安装工作流…', function () {
      if (!dialogs.confirm(item.installed ? '更新工作流' : '安装工作流', item.name + '\n' + version(item.available) + '\n\n来源：' + manager.source.url + '\n仅安装你信任的工作流，脚本运行时拥有 AutoJs6 的权限。')) return '已取消安装';
      return manager.install(item.id, token) ? '已校验并安装，下次运行使用此版本' : '已经安装相同版本';
    });
  }
  function saveSource(next) {
    var nextSettings = JSON.parse(JSON.stringify(settings));
    nextSettings.source = core.source(next); nextSettings.initialized = true;
    var nextManager = core.create(io, io.root, nextSettings.source);
    io.writeAtomic(settingsFile, JSON.stringify(nextSettings, null, 2));
    settings = nextSettings; token = ''; manager = nextManager;
    return '来源已切换，请刷新目录；旧来源的配置与记录保留';
  }
  function sourceSettings() {
    perform('来源设置', function () {
      var choice = dialogs.select('工作流来源', ['设置 GitHub 仓库', '输入 / 清除私有仓库令牌', '恢复官方来源']);
      if (choice === 0) {
        var url = dialogs.rawInput('GitHub 仓库根地址', manager.source.url); if (!url) return '已取消设置';
        var reference = dialogs.rawInput('分支或标签', manager.source.reference); if (!reference) return '已取消设置';
        return saveSource({ url: String(url).trim(), reference: String(reference).trim() });
      }
      if (choice === 1) { var secret = readSecret(); if (secret !== null) token = String(secret).trim(); return token ? '本次使用期间已设置只读令牌' : '未设置仓库令牌'; }
      if (choice === 2) return saveSource(defaultSource);
      return '设置未更改';
    });
  }
  ui.sourceSettings.on('click', sourceSettings);
  ui.refresh.on('click', function () { perform('正在从仓库读取目录…', function () { var snapshot = manager.refresh(token); return '目录已刷新 · ' + snapshot.catalog.workflows.length + ' 个工作流包'; }); });
  ui.updateAll.on('click', function () {
    perform('正在更新已安装工作流…', function () {
      if (!dialogs.confirm('更新全部工作流', '更新此来源已安装的工作流；配置和运行记录会保留。')) return '已取消更新';
      var result = manager.check(token); show('更新结果', summary(result)); return result.errors.length ? '部分更新未完成，请查看结果；原版本仍保留' : '已安装工作流已全部更新';
    });
  });
  ['all', 'installed', 'updates'].forEach(function (name) { ui[name].on('click', function () { filter = name; render(); }); });
  ui.query.addTextChangedListener(new android.text.TextWatcher({
    beforeTextChanged: function () {}, onTextChanged: function () { render(); }, afterTextChanged: function () {}
  }));
  ui.more.on('click', function () {
    perform('更多操作', function () {
      var choice = dialogs.select('手机工作流商店', ['导入本地工作流包', '导出最近运行日志', '定时任务', timerRunning() ? '停止后续定时执行' : '开启手机定时执行', '退出商店']);
      if (choice === 0) {
        var path = dialogs.rawInput('本地工作流包路径', files.path('./PorAuto-mobile-scripts.json'));
        if (!path) return '已取消导入';
        if (!dialogs.confirm('导入工作流包', '请确认文件来自你信任的发布者。完整性校验可以检测损坏，不能保证脚本行为安全。')) return '已取消导入';
        var imported = manager.importBundle(io.importFile(String(path))); show('导入结果', summary(imported));
        return imported.errors.length ? '部分工作流未能导入，请查看结果' : '工作流包已校验并导入';
      }
      if (choice === 1) { var debug = manager.exportLogs(); debug.schedules = scheduler.list(); var output = io.exportFile(debug); show('日志已导出', output + '\n\n包含版本、运行结果和定时状态，不包含配置快照或仓库令牌。'); app.viewFile(output); return '运行日志已导出'; }
      if (choice === 2) { manageSchedules(); return '定时任务配置保存在本机'; }
      if (choice === 3) {
        if (!timerRunning()) return startTimer();
        timerStop.set(true); return '已停止后续触发，当前执行结束后释放运行会话';
      }
      if (choice === 4) { if (timerRunning()) return '请先停止后续定时执行，再退出商店'; closed = true; token = ''; ui.run(function () { ui.finish(); }); }
      return '工作流配置与记录保存在本机';
    });
  });
  ui.emitter.on('back_pressed', function (event) {
    if (busy || timerRunning()) { event.consumed = true; toast(timerRunning() ? '请在「更多」先停止定时执行，再退出商店' : '操作正在进行，请等待完成'); }
    else { token = ''; closed = true; }
  });
  events.on('exit', function () { if (timerStop) timerStop.set(true); token = ''; closed = true; });
  perform('正在加载本机工作流…', function () {
    if (!settings.initialized) {
      if (manager.source.url === defaultSource.url && manager.source.reference === defaultSource.reference && !manager.list().installed.length) manager.importBundle(bundled);
      settings.initialized = true; io.writeAtomic(settingsFile, JSON.stringify(settings, null, 2));
    }
    // Keep installed packages usable before any network request, including offline launches.
    var installed = manager.list();
    ui.run(function () { state = installed; render(); });
    try { manager.refresh(token); return '目录已刷新，选择工作流即可安装或运行'; }
    catch (error) { return '暂未取得更新：' + String(error.message || error) + '\n已安装工作流仍可离线运行'; }
  });
}
