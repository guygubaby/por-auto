'use strict';

module.exports = function (por) {
  var core = require('./core.js'), requests = require('./request.js'), definitions = require('./definitions.js');
  var config = por.readConfig(), native = definitions.package === 'com.tencent.wework', label = native ? '企业微信' : '微信';
  if (!config.input) config.input = { message: { type: 'manual', text: 'Ok' }, recipients: { scope: 'groups', mode: 'selected', names: [] }, intervalMs: 1000 };
  if (!config.hooks) config.hooks = {};
  var io = require(native ? './wecom.js' : './android.js').create(por, config);
  function execute(workflow) {
    var result, error = null;
    try { io.prepare(workflow); result = core.create(io).run(workflow, config); }
    catch (e) { error = e; }
    finally { try { io.finish(); } catch (e) { error = error || e; } }
    if (error) throw error;
    return result;
  }
  if (por.execution) {
    var selected = definitions.workflows.filter(function (workflow) { return workflow.id === por.execution.workflowId; });
    if (selected.length !== 1 || typeof por.execution.dryRun !== 'boolean') throw new Error('定时任务的工作流或运行方式无效');
    config.dryRun = por.execution.dryRun;
    return execute(selected[0]);
  }
  function pick(title, choices) { var n = dialogs.select(title, choices); if (n < 0) throw new Error('已取消'); return n; }
  function ask(title, previous) { var value = dialogs.rawInput(title, previous === undefined ? '' : String(previous)); if (value === null) throw new Error('已取消'); return String(value); }
  function secret(title) {
    var result = threads.disposable(), completed = false;
    var dialog = dialogs.build({ title: title, content: '仅在手机加密保存，不放入脚本或调试文件。', inputType: 129, inputSingleLine: true, positive: '保存', negative: '取消' });
    dialog.on('positive', function (d) { if (!completed) { completed = true; result.setAndNotify(String(d.getInputEditText().getText())); } });
    dialog.on('dismiss', function () { if (!completed) { completed = true; result.setAndNotify(null); } });
    dialog.show();
    var value = result.blockedGet(); if (value === null) throw new Error('已取消'); return String(value);
  }
  function pairs(title, previous) {
    var value = ask(title + '\n每行一个：名称=值；可以留空', (previous || []).map(function (p) { return p.name + '=' + p.value; }).join('\n'));
    return value.split(/\r?\n/).filter(function (line) { return line.trim(); }).map(function (line) { var i = line.indexOf('='); if (i < 1) throw new Error('参数格式应为 名称=值'); return { name: line.slice(0, i).trim(), value: line.slice(i + 1) }; });
  }
  function editRequest(previous, ignore) {
    var value = previous ? JSON.parse(JSON.stringify(previous)) : { url: '', method: 'GET', query: [], headers: [], auth: { type: 'none' }, body: null, response: { type: ignore ? 'ignore' : 'text' }, timeoutSeconds: 20 };
    var previousUrl = value.url, url = ask('请求地址（HTTPS；127.0.0.1 指手机本身）', value.url).trim();
    value.url = url;
    value.method = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'][pick('请求方式', ['GET · 获取', 'POST · 提交', 'PUT · 替换', 'PATCH · 修改', 'DELETE · 删除'])];
    value.query = pairs('查询参数', value.query); value.headers = pairs('额外请求头（鉴权在下一步设置）', value.headers);
    var auth = pick('接口鉴权', ['无需鉴权', 'Bearer Token', '用户名和密码', 'API Key']);
    if (!auth) value.auth = { type: 'none' };
    else {
      var credential = value.auth.credential;
      if (!credential || url !== previousUrl || !dialogs.confirm('已保存鉴权', '保留之前加密保存的鉴权值？选择取消可重新输入。')) credential = io.saveSecret(url, secret(auth === 2 ? '接口密码' : 'Token / API Key'));
      value.auth = { type: ['none', 'bearer', 'basic', 'api_key'][auth], credential: credential };
      if (auth === 2) value.auth.username = ask('用户名', previous && previous.auth.username || '');
      if (auth === 3) {
        value.auth.name = ask('API Key 名称', previous && previous.auth.name || 'X-API-Key');
        value.auth.location = pick('API Key 放在哪里', ['请求头', '查询参数']) === 0 ? 'header' : 'query';
      }
    }
    if (['POST', 'PUT', 'PATCH'].indexOf(value.method) >= 0) {
      var body = ask('请求内容（JSON，可以留空）\n逐会话请求可使用 {{recipient.title}} 等变量', value.body === null ? '' : JSON.stringify(value.body, null, 2));
      try { value.body = body.trim() ? JSON.parse(body) : null; } catch (_) { throw new Error('请求内容不是有效 JSON'); }
    } else value.body = null;
    var parser = pick('如何读取返回内容', ignore ? ['忽略正文，只检查请求成功', '全文作为文字', '提取 JSON 字段'] : ['全文作为消息', '提取 JSON 字段']);
    if (ignore && parser === 0) value.response = { type: 'ignore' };
    else if (parser === (ignore ? 2 : 1)) value.response = { type: 'json', pointer: ask('消息字段路径，例如 /data/message', previous && previous.response.pointer || '/data/message') };
    else value.response = { type: 'text' };
    value.timeoutSeconds = Number(ask('等待接口返回的秒数（5～120）', value.timeoutSeconds));
    requests.validate(value, io); return value;
  }
  function testRequest(value) {
    var preview = requests.preview(value, { run: { id: por.runId, mode: 'rehearsal', status: 'running' }, workflow: { id: native ? 'wecom-broadcast' : 'wechat-broadcast', name: label + '批量发送消息', version: '1.0.0' }, recipient: { title: '测试会话', index: 1, total: 1 } }, io);
    dialogs.alert(preview.parseError ? '请求成功，解析未通过' : '请求与解析通过', '状态：' + preview.status + '\n耗时：' + preview.elapsedMs + ' ms\n\n最终消息：\n'
      + (preview.parseError || (preview.message === null ? '已忽略正文' : preview.message)) + '\n\n原始内容（最多显示 2000 字）：\n' + preview.raw.slice(0, 2000));
  }
  function chooseRecipients() {
    var next = JSON.parse(JSON.stringify(config.input));
    next.recipients.scope = pick('接收范围', ['群聊', '首页聊天会话']) === 0 ? 'groups' : 'conversations';
    var selection = pick('选择接收对象', ['读取列表后勾选', '手动填写完整名称', '全部']);
    if (selection === 2) next.recipients = { scope: next.recipients.scope, mode: 'all', names: [] };
    else if (selection === 1) {
      next.recipients.mode = 'selected';
      next.recipients.names = ask('每行一个完整名称，不支持模糊匹配', next.recipients.names.join('\n')).split(/\r?\n/).map(function (n) { return n.trim(); }).filter(Boolean);
    } else {
      var items;
      try { io.prepare(); io.launch(); items = core.create(io).discover(next.recipients.scope); }
      finally { io.finish(); }
      if (!items.length) throw new Error('没有读取到会话');
      var selected = dialogs.multiChoice('勾选接收对象', items, items.map(function (n, i) { return next.recipients.names.indexOf(n) >= 0 ? i : -1; }).filter(function (i) { return i >= 0; }));
      if (selected === null) throw new Error('已取消');
      next.recipients.mode = 'selected'; next.recipients.names = [];
      for (var i = 0; i < selected.length; i++) next.recipients.names.push(items[Number(selected[i])]);
    }
    next.intervalMs = Number(ask('每个会话处理完后的间隔（毫秒，至少 1000）', next.intervalMs));
    core.validateInput(next); config.input = next; por.saveConfig(config);
  }
  function chooseMessage() {
    var type = pick('消息从哪里获取', ['手动输入', '接口获取', '使用前置请求的返回内容']);
    var next;
    if (type === 0) next = { type: 'manual', text: ask('要发送的消息', config.input.message.type === 'manual' ? config.input.message.text : 'Ok') };
    else if (type === 1) {
      var value = editRequest(config.input.message.request, false);
      if (dialogs.confirm('测试接口', '现在获取并解析一次内容？不会操作手机或发送消息。')) testRequest(value);
      next = { type: 'http', request: value, refresh: pick('何时获取最新内容', ['每轮开始时获取一次', '进入每个会话后获取最新内容']) === 0 ? 'run' : 'recipient' };
    } else {
      if (!config.hooks.beforeRun || config.hooks.beforeRun.response.type === 'ignore') throw new Error('请先配置能返回文字的前置请求');
      next = { type: 'before_run' };
    }
    if (next.type === 'manual') core.validateMessage(next.text);
    config.input.message = next; por.saveConfig(config);
  }
  function provider() {
    var previous = config.provider || {}, next = {};
    next.baseUrl = ask('图像接口根地址，例如 https://example.com/v1\n手机上的 127.0.0.1 不是电脑。独立运行需要手机可访问的接口。', previous.baseUrl || 'https://').replace(/\/+$/, '');
    var parsed = io.parseUrl(next.baseUrl);
    if (!parsed || !(parsed.scheme === 'https' || parsed.scheme === 'http' && ['localhost', '127.0.0.1', '::1', '[::1]'].indexOf(parsed.host) >= 0) || parsed.username || parsed.password || /[?#]/.test(next.baseUrl) || /\/chat\/completions$/.test(next.baseUrl)) throw new Error('请填写不含鉴权信息的 HTTPS 接口根地址；仅手机本机可用 HTTP');
    next.model = ask('支持图片输入的模型名称', previous.model || '').trim();
    if (!next.model || next.model.length > 200 || /[\x00-\x1f]/.test(next.model)) throw new Error('模型名称无效');
    next.timeoutSeconds = previous.timeoutSeconds || 120;
    if (typeof previous.thinking === 'boolean') next.thinking = previous.thinking;
    if (previous.credential && previous.baseUrl === next.baseUrl && dialogs.confirm('接口凭据', '保留之前保存的 API Key？')) next.credential = previous.credential;
    else if (dialogs.confirm('接口凭据', '这个接口需要 API Key 吗？')) next.credential = io.saveSecret(next.baseUrl, secret('模型 API Key'));
    io.checkModel(next);
    next.allowScreenshots = dialogs.confirm('允许读取微信画面', '运行时会把微信截图发送到你填写的接口，画面可能包含昵称和聊天内容。\n\n接口：' + next.baseUrl + '\n模型：' + next.model + '\n\n是否允许？');
    config.provider = next; por.saveConfig(config);
  }
  function exportLast() {
    var path = por.dataDir + '/last-result.json';
    if (!files.exists(path)) throw new Error('尚无工作流结果');
    var parent = context.getExternalFilesDir(null);
    if (!parent) throw new Error('手机文件导出目录不可用');
    var output = String(parent.getPath()) + '/por-auto-exports/wechat-mobile-' + Date.now() + '.json';
    files.createWithDirs(output);
    if (!files.copy(path, output)) throw new Error('导出失败');
    dialogs.alert('已导出结果', output + '\n包含每个接收会话的状态，不包含 API Key。'); app.viewFile(output);
  }
  function schedule() {
    if (!por.schedules) throw new Error('请重新导入最新版手机商店启动脚本，再设置定时任务；原配置保留');
    var workflow = definitions.workflows[pick('定时运行哪个工作流', definitions.workflows.map(function (item) { return item.name; }))];
    var sender = workflow.steps.some(function (step) { return ['wechat_send_text', 'wechat_broadcast', 'chat_send_text', 'chat_broadcast'].indexOf(step.action.type) >= 0; });
    var dryRun = !sender || pick('定时运行方式', ['预演：核对草稿后清理，不发送', '正式发送：每个目标发送一次']) === 0;
    if (['wechat-broadcast', 'wecom-broadcast'].indexOf(workflow.id) >= 0) core.validateInput(config.input);
    if (!native && (!config.provider || !config.provider.allowScreenshots)) throw new Error('请先完成模型与截图设置');
    if (config.hooks.beforeRun) requests.validate(config.hooks.beforeRun, io);
    if (config.hooks.afterRun) requests.validate(config.hooks.afterRun, io);
    if (config.input.message.type === 'http') requests.validate(config.input.message.request, io);
    var name = ask('任务名称', workflow.name).trim();
    var expression = ask('五段 Cron：分 时 日 月 周\n每天 9 点：0 9 * * *\n每 30 分钟：*/30 * * * *', '0 9 * * *').trim();
    var timezone = ask('执行时区', por.schedules.timezone).trim();
    var times = por.schedules.preview(expression, timezone);
    if (!dialogs.confirm('保存定时任务', name + '\n' + expression + ' · ' + timezone + '\n\n接下来三次：\n' + times.map(function (time) { return por.schedules.formatTime(time, timezone); }).join('\n')
        + '\n\n固定当前工作流版本、消息和接收配置。错过不补跑，执行中不重复触发。\n保存后，在商店「更多」开启手机定时执行。')) return;
    por.saveConfig(config);
    por.schedules.save({ name: name, cron: expression, timezone: timezone, enabled: true }, { workflowId: workflow.id, dryRun: dryRun });
    dialogs.alert('定时任务已保存', '回到商店「更多 → 定时任务」管理启停或立即运行。修改消息或接收范围后，请重新创建任务以使用新配置。');
  }
  function inputComponent(){
    var setup=require('./input-setup.js'),status=setup.state();
    var choice=pick('输入组件 · '+(status.installed?'已安装':'待安装')+' / '+(status.enabled?'已启用':'待启用')+'\n运行时自动切换，结束后恢复先前的键盘。', ['安装或更新输入组件','在系统中启用组件','选择日常键盘','返回']);
    if(choice===0){setup.install();return true;}
    if(choice===1){setup.settings();return true;}
    if(choice===2){setup.pick();return true;}
    return false;
  }
  while (true) {
    var menu=['运行工作流','配置消息内容','选择接收对象','前置 / 结束请求',native?'原生控件说明':'模型与截图设置','导出上次运行结果','新建定时任务'];
    if(!native)menu.push('输入组件');menu.push('退出');
    var choice = dialogs.select(label + '手机工作流',menu);
    if (choice < 0 || choice === menu.length-1) return;
    try {
      if (choice === 0) {
        var workflow = definitions.workflows[pick('选择工作流', definitions.workflows.map(function (w) { return w.name + ' · v' + w.version; }))];
        var sender = workflow.steps.some(function (s) { return ['wechat_send_text', 'wechat_broadcast', 'chat_send_text', 'chat_broadcast'].indexOf(s.action.type) >= 0; });
        config.dryRun = sender && pick('运行方式', ['预演：填入并核对草稿后清理，不点击发送', '正式发送：每个目标发送一次']) === 0;
        if (['wechat-broadcast', 'wecom-broadcast'].indexOf(workflow.id) >= 0) core.validateInput(config.input);
        var scope = config.input.recipients;
        var detail = ['wechat-broadcast', 'wecom-broadcast'].indexOf(workflow.id) >= 0 ? '\n接收：' + (scope.mode === 'all' ? '全部' : scope.names.length + ' 个指定') + (scope.scope === 'groups' ? '群聊' : '首页会话') : '';
        if (!dialogs.confirm('开始' + (sender ? config.dryRun ? '预演' : '发送' : '运行'), workflow.name + detail + '\n\n运行中请保持手机解锁，不要手动切换页面。')) continue;
        var result = execute(workflow);
        var labels = { nickname: label + '姓名', chat_title: '当前会话', target_count: '已处理对象', message_status: '处理状态' };
        var statuses = { rehearsed: '预演完成', observed: '已在界面看到新消息' };
        dialogs.alert('工作流已完成', workflow.name + '\n\n' + Object.keys(result).map(function (k) { return (labels[k] || '结果') + '：' + (k === 'message_status' ? statuses[result[k]] || result[k] : result[k]); }).join('\n') + (sender && config.dryRun ? '\n\n预演完成，未点击发送。' : ''));
        return;
      } else if (choice === 1) chooseMessage();
      else if (choice === 2) chooseRecipients();
      else if (choice === 3) {
        var name = pick('生命周期请求', ['开始前获取数据', '结束后通知结果']) === 0 ? 'beforeRun' : 'afterRun';
        if (config.hooks[name] && dialogs.confirm('移除请求', '删除当前配置的这个请求？选择取消可编辑。')) delete config.hooks[name];
        else config.hooks[name] = editRequest(config.hooks[name], name === 'afterRun');
        por.saveConfig(config);
      } else if (choice === 4) { if (native) dialogs.alert('原生控件执行', '企业微信通过系统控件读取和输入，不需要截图授权或图像模型。'); else provider(); }
      else if (choice === 5) exportLast();
      else if (choice === 6) schedule();
      else if (choice === 7 && !native) {if(inputComponent())return;}
    } catch (e) {
      if (String(e.message || e) === '已取消') continue;
      if (choice === 0) throw e;
      dialogs.alert('操作未完成', String(e.message || e));
    }
  }
};
