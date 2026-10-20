'use strict';

function fail(message) { throw new Error(message); }
function object(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function key(name) { return String(name).replace(/\s/g, '').replace(/（/g, '(').replace(/）/g, ')').replace(/[｜丨]/g, '|'); }
function same(actual, expected) {
  var a = key(actual), b = key(expected);
  return a === b || groupTitle(actual, expected);
}
function groupTitle(actual, expected) {
  var a = key(actual), prefix = key(expected) + '(';
  return a.indexOf(prefix) === 0 && /^\d+\)$/.test(a.slice(prefix.length));
}
function point(p) { return Array.isArray(p) && p.length === 2 && p.every(function (n) { return typeof n === 'number' && n % 1 === 0 && n > 0 && n < 1000; }); }
function invalidObservation(message) { var error = new Error(message); error.code = 'INVALID_OBSERVATION'; throw error; }
function message(text) {
  if (typeof text !== 'string' || !text.trim() || unescape(encodeURIComponent(text)).length > 4000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) fail('消息不能为空，最多 4000 字节，不能包含控制字符');
  return text;
}
function screen(value) {
  var roles = ['tab', 'search', 'search_input', 'chat', 'group', 'more', 'new_chat', 'choose_group', 'profile', 'row', 'keyboard', 'send', 'back'];
  if (!object(value) || !value.certain || ['home', 'me', 'profile', 'chat', 'search', 'new_chat', 'groups', 'other'].indexOf(value.page) < 0
      || typeof value.title !== 'string' || value.title.length > 500 || value.page === 'chat' && !value.title.trim() || !Array.isArray(value.items) || value.items.length > 100
      || !Array.isArray(value.outgoing) || value.outgoing.length > 100 || typeof value.listEmpty !== 'boolean') invalidObservation('页面识别不完整，未猜测点击位置');
  value.items = value.items.filter(function (i) { return !(object(i) && i.role === 'send' && i.point === null); });
  value.items.forEach(function (i) {
    if (!object(i) || roles.indexOf(i.role) < 0 || typeof i.text !== 'string' || i.text.length > 1000 || !point(i.point) || typeof i.complete !== 'boolean'
        || !(i.value === null || typeof i.value === 'string' && i.value.length <= 4000)) invalidObservation('页面控件格式无效，未点击');
  });
  if (value.editor !== null && (!object(value.editor) || !point(value.editor.point) || !(value.editor.text === null || typeof value.editor.text === 'string' && value.editor.text.length <= 4000))) invalidObservation('输入框无法完整读取，未输入');
  value.outgoing.forEach(function (b) { if (!object(b) || typeof b.text !== 'string' || b.text.length > 4000 || typeof b.pending !== 'boolean' || typeof b.failed !== 'boolean') invalidObservation('消息状态格式无效'); });
  if (value.page === 'other' && value.title === '安全保护中') fail('微信需要账号本人完成验证，当前流程已停止，未重试发送');
  return value;
}
function unique(s, role) {
  var items = s.items.filter(function (i) { return i.complete && (i.role === role
    || role === 'choose_group' && s.page === 'new_chat' && ['选择一个群', '选择群聊', '选择一个已有的群'].indexOf(i.text) >= 0
    || role === 'new_chat' && s.page === 'other' && i.text === '发起群聊'); });
  if (items.length !== 1) fail('不能唯一确认页面入口：' + role);
  return items[0];
}
function names(s, page) {
  if (s.page !== page) fail('页面已离开会话列表');
  var rows = s.items.filter(function (i) { return ['chat', 'group'].indexOf(i.role) >= 0; }).sort(function (a, b) { return a.point[1] - b.point[1] || a.point[0] - b.point[0]; });
  if (!rows.length && !s.listEmpty) fail('不能确认列表为空，未开始处理');
  var seen = [], result = [];
  rows.forEach(function (i) {
    if (!i.complete || !i.text.trim() || /…|\.\.\.$/.test(i.text)) fail('会话名称没有完整显示，请改用指定的完整名称');
    if (seen.indexOf(key(i.text)) >= 0) fail('列表有无法区分的重名会话');
    seen.push(key(i.text)); result.push(i.text);
  });
  return result;
}
function equalSet(a, b) { return a.map(key).sort().join('\n') === b.map(key).sort().join('\n'); }
function merge(a, b) {
  var left = a.map(key), right = b.map(key), overlap = Math.min(a.length, b.length);
  while (overlap && left.slice(left.length - overlap).join('\n') !== right.slice(0, overlap).join('\n')) overlap--;
  b.slice(overlap).forEach(function (n) { if (left.indexOf(key(n)) >= 0) fail('会话顺序在读取中发生变化，请重新读取'); a.push(n); left.push(key(n)); });
  if (a.length > 2000) fail('本轮超过 2000 个会话，请分批处理');
  return a;
}
function checkChat(s, title) { if (s.page !== 'chat' || !same(s.title, title)) fail('当前页面不能确认为目标会话「' + title + '」'); }
function input(value) {
  if (!object(value) || !object(value.recipients) || ['groups', 'conversations'].indexOf(value.recipients.scope) < 0
      || ['all', 'selected'].indexOf(value.recipients.mode) < 0 || !Array.isArray(value.recipients.names) || value.recipients.names.length > 2000
      || typeof value.intervalMs !== 'number' || value.intervalMs % 1 || value.intervalMs < 1000 || value.intervalMs > 600000) fail('请先配置消息、接收范围与间隔');
  var seen = [];
  value.recipients.names.forEach(function (n) { if (typeof n !== 'string' || !n.trim() || n.length > 200 || /[\x00-\x1f]/.test(n) || seen.indexOf(key(n)) >= 0) fail('接收会话名称无效或重复'); seen.push(key(n)); });
  if (value.recipients.mode === 'selected' && !seen.length) fail('请至少选择一个接收会话');
  if (!object(value.message) || ['manual', 'http', 'before_run'].indexOf(value.message.type) < 0) fail('消息来源无效');
  if (value.message.type === 'manual') message(value.message.text);
  if (value.message.type === 'http' && ['run', 'recipient'].indexOf(value.message.refresh) < 0) fail('请选择每轮或每个会话获取消息');
  return value;
}

function create(io) {
  var observations = 0;
  function observe(hint) {
    for (var attempt = 0; attempt < 3; attempt++) {
      if (++observations > 20000) fail('页面读取次数达到本轮上限');
      try {
        var value = io.observe(hint || '');
        if (attempt < 2 && object(value) && (value.certain === false || value.page === 'chat' && typeof value.title === 'string' && !value.title.trim())) {
          io.log('observation_wait', '页面被遮挡或标题不完整，等待后重新读取，未执行操作'); io.sleep(1500); continue;
        }
        return screen(value);
      } catch (error) {
        if (attempt >= 2 || error.code !== 'INVALID_OBSERVATION') throw error;
        io.log('observation_rejected', '页面格式或坐标无效，重新读取，未执行操作'); io.sleep(800);
      }
    }
  }
  function click(p) { if (!point(p)) fail('点击坐标无效'); io.click(p); io.sleep(800); }
  function home() {
    for (var n = 0; n < 8; n++) {
      var s = observe('定位底部四个导航项，识别当前页面。');
      if (['微信', '通讯录', '发现', '我'].every(function (label) { return s.items.some(function (i) { return i.role === 'tab' && i.text === label; }); })) {
        if (s.page === 'home') return s;
        io.clickTab('微信'); io.sleep(800);
      } else { io.back(); io.sleep(650); }
    }
    fail('未能返回微信第一个页面');
  }
  function beginning(s) {
    var page = s.page, previous = names(s, page);
    for (var n = 0; n < 300; n++) {
      io.scroll(true); s = observe();
      if (page === 'home' && s.page === 'other' && s.title === '最近' && s.items.some(function (i) { return i.text === '搜索小程序'; })) { io.back(); io.sleep(600); s = observe(); names(s, page); return s; }
      var next = names(s, page);
      if (equalSet(next, previous)) return s;
      previous = next;
    }
    fail('未能确认列表开头');
  }
  function recipientPage(scope) {
    var s = home();
    if (scope === 'groups') {
      click(unique(s, 'more').point); s = observe();
      click(unique(s, 'new_chat').point); s = observe();
      if (s.page !== 'new_chat') fail('没有打开现有群聊选择入口');
      click(unique(s, 'choose_group').point); s = observe();
      if (s.page !== 'groups') fail('无法确认现有群聊列表');
    }
    return s;
  }
  function discover(scope) {
    var s = beginning(recipientPage(scope)), page = s.page, result = [];
    for (var n = 0; n < 300; n++) {
      var current = names(s, page); merge(result, current);
      io.scroll(false); var next = observe();
      if (equalSet(names(next, page), current)) {
        io.scroll(false); s = observe();
        if (equalSet(names(s, page), current)) return result;
      } else s = next;
    }
    fail('没有确认列表末尾，未开始发送');
  }
  function confirm(title) {
    for (var attempt = 0; attempt < 4; attempt++) {
      if (attempt) io.sleep(800);
      var s = observe('核对是否已进入目标聊天，标题必须为 ' + JSON.stringify(title) + '；搜索结果不是聊天页面。');
      if (s.page === 'chat') { checkChat(s, title); return s; }
      if (['home', 'search', 'groups'].indexOf(s.page) < 0) break;
      io.log('chat_transition_wait', '尚未观察到目标聊天，等待后重新读取；未重复点击');
    }
    fail('目标会话未完成页面切换，未继续输入或发送');
  }
  function openFirst() {
    var s = beginning(home()), list = names(s, 'home');
    if (!list.length) fail('会话列表为空');
    var row = s.items.filter(function (i) { return ['chat', 'group'].indexOf(i.role) >= 0 && i.text === list[0]; })[0];
    io.openRow(row.text, 'home', row.point); confirm(row.text); return row.text;
  }
  function openNamed(title) {
    if (!namedPage(title)) fail('没有唯一匹配的完整会话名称：' + title);
    return title;
  }
  function namedPage(title) {
    var s = home(), found = s.items.filter(function (i) { return ['chat', 'group'].indexOf(i.role) >= 0 && i.complete && key(i.text) === key(title); });
    if (found.length > 1) return null;
    if (!found.length) {
      click(unique(s, 'search').point); s = observe('核对全局搜索页及搜索框，输入框显示搜索本地或网络结果时 value 为空字符串。');
      if (s.page !== 'search') fail('没有确认微信全局搜索页，未输入');
      var search = unique(s, 'search_input');
      if (search.value !== '') fail('搜索框已有内容或无法读取，未覆盖');
      io.type(title, search.point); io.sleep(800);
      s = observe('精确定位本地搜索结果 ' + JSON.stringify(title) + '，不要选择搜索框或网络建议。');
      if (s.page !== 'search' || unique(s, 'search_input').value !== title) fail('搜索内容未能核对');
      found = s.items.filter(function (i) { return ['chat', 'group'].indexOf(i.role) >= 0 && i.complete && key(i.text) === key(title); });
    }
    if (found.length !== 1) return null;
    io.openRow(title, s.page, found[0].point); return confirm(title);
  }
  function openGroup(title) {
    var searched = namedPage(title);
    if (searched && groupTitle(searched.title, title)) return title;
    var s = recipientPage('groups');
    for (var n = 0; n < 300; n++) {
      var found = s.items.filter(function (i) { return i.role === 'group' && i.complete && key(i.text) === key(title); });
      if (found.length > 1) fail('群聊名称重复，未打开');
      if (found.length) { io.openRow(title, 'groups', found[0].point); confirm(title); return title; }
      if (n === 0) s = beginning(s);
      else { io.scroll(false); s = observe(); }
      names(s, 'groups');
    }
    fail('现有群聊列表没有找到：' + title);
  }
  function send(title, text, dryRun, intent) {
    message(text);
    var s = observe(); checkChat(s, title);
    if (!s.editor) { click(unique(s, 'keyboard').point); s = observe(); checkChat(s, title); }
    if (!s.editor) fail('无法确认文字输入框');
    if (dryRun && s.editor.text === text) { io.log('draft_verified', { title: title, retained: true }); return; }
    if (s.editor.text !== '') fail('会话有已有草稿或无法完整读取，未覆盖');
    io.type(text, s.editor.point, title); s = observe('精确核对聊天标题和输入框的完整文字。'); checkChat(s, title);
    if (!s.editor || s.editor.text !== text) fail('输入内容未能精确核对，未发送，请检查手机草稿');
    io.log('draft_verified', { title: title });
    if (dryRun) {
      io.beforeCommit(s.editor.point);
      io.clear(text, s.editor.point); s = observe(); checkChat(s, title);
      if (!s.editor || s.editor.text !== '') fail('预演草稿清理未能确认，未发送');
      return;
    }
    var button = unique(s, 'send');
    if (button.text !== '发送' || button.point[0] <= s.editor.point[0] || Math.abs(button.point[1] - s.editor.point[1]) > 120) fail('不能确认发送按钮');
    var count = s.outgoing.filter(function (b) { return b.text === text && !b.pending && !b.failed; }).length;
    io.beforeCommit(s.editor.point);
    intent(); io.log('send_requested', { title: title }); click(button.point);
    var after = observe(); checkChat(after, title);
    if (!after.editor || after.editor.text !== '' || after.outgoing.some(function (b) { return b.failed || b.pending; })
        || after.outgoing.filter(function (b) { return b.text === text && !b.failed && !b.pending; }).length <= count) fail('发送结果不明，未自动重发');
    io.log('send_observed', { title: title });
  }
  function tap(selector, skipIf, recover) {
    function matches(s, select) {
      return s.items.filter(function (i) { return i.complete && ((select.text || []).indexOf(i.text) >= 0 || (select.prefix || []).some(function (p) { return i.text.indexOf(p) === 0 || i.role === 'profile' && i.text.split(/\s+/).some(function (part) { return part.indexOf(p) === 0; }); })); });
    }
    for (var n = 0; n <= (recover || 0); n++) {
      var s = observe('定位工作流控件：' + JSON.stringify(selector) + '。底部四个导航项必须作为 role tab，不要把聊天内容当作导航。');
      if ((skipIf || []).some(function (p) { return (p.text || []).indexOf(s.title) >= 0 || matches(s, p).length > 0; })) return;
      var found = matches(s, selector);
      if (selector.bottom) found = found.filter(function (i) { return i.role === 'tab'; });
      if ((selector.peers || []).some(function (p) { return !s.items.some(function (i) { return i.text === p; }); })) found = [];
      if (found.length === 1) {
        if (selector.bottom) { io.clickTab(found[0].text); io.sleep(800); }
        else click(found[0].point);
        return;
      }
      if (n < (recover || 0)) { io.back(); io.sleep(500); }
    }
    fail('未找到唯一匹配的工作流控件');
  }
  function run(workflow, config) {
    if (!object(workflow) || workflow.package !== 'com.tencent.mm' || !Array.isArray(workflow.steps)) fail('不支持的手机工作流');
    var allowed = ['wake', 'launch', 'wait', 'back', 'tap', 'read_row', 'wechat_home', 'wechat_first_chat', 'wechat_open_chat', 'wechat_send_text', 'wechat_broadcast'];
    workflow.steps.forEach(function (s) { if (!s.action || allowed.indexOf(s.action.type) < 0) fail('手机运行器不支持这个动作'); });
    var request = require('./request.js'), outputs = {}, deliveries = [], status = 'running', error = null;
    var dryRun = config.dryRun !== false, hooks = config.hooks || {};
    var context = { run: { id: io.runId, mode: dryRun ? 'rehearsal' : 'send', status: status }, workflow: { id: workflow.id, name: workflow.name, version: workflow.version } };
    var chat = null, prepared = null, preparedAt = null, startedAt = io.now();
    function fetch(spec) { return request.fetch(spec, context, io); }
    function persist() { io.record({ schemaVersion: 1, runId: io.runId, startedAt: startedAt, finishedAt: status === 'running' ? null : io.now(), status: status, error: error, dryRun: dryRun, workflow: workflow.id, workflowName: workflow.name, workflowVersion: workflow.version, outputs: outputs, targets: deliveries }); }
    function batch(value) {
      input(value);
      if (value.message.type === 'manual') prepared = message(value.message.text);
      else if (value.message.type === 'before_run') { prepared = message(context.before && context.before.message); preparedAt = context.before.fetchedAt; }
      else if (value.message.refresh === 'run') { var initial = fetch(value.message.request); prepared = initial.message; preparedAt = initial.fetchedAt; }
      var listed = discover(value.recipients.scope);
      var targets = value.recipients.mode === 'all' ? listed : value.recipients.names.map(function (name) {
        var matches = listed.filter(function (n) { return key(n) === key(name); });
        if (matches.length !== 1) fail('指定会话「' + name + '」不在当前列表或重名，未开始处理');
        return matches[0];
      });
      if (!targets.length) fail('没有可处理的接收会话');
      deliveries = targets.map(function (title) { return { title: title, status: 'pending', error: null }; }); persist();
      for (var index = 0; index < targets.length; index++) {
        var target = deliveries[index], attempted = false;
        context.recipient = { title: target.title, index: index + 1, total: targets.length };
        target.status = dryRun ? 'rehearsing' : 'opening'; persist();
        try {
          if (value.recipients.scope === 'groups') openGroup(target.title); else openNamed(target.title);
          var latest = prepared === null ? fetch(value.message.request) : null;
          var text = latest ? latest.message : prepared;
          target.fetchedAt = latest ? latest.fetchedAt : preparedAt; persist();
          send(target.title, text, dryRun, function () { attempted = true; target.status = 'sending'; persist(); });
          target.status = dryRun ? 'rehearsed' : 'sent'; persist();
        } catch (e) {
          target.status = attempted ? 'uncertain' : 'failed'; target.error = String(e.message || e);
          deliveries.slice(index + 1).forEach(function (d) { d.status = 'skipped'; }); persist(); throw e;
        }
        if (index + 1 < targets.length) io.sleep(value.intervalMs);
      }
      outputs.target_count = String(targets.length);
      outputs.message_status = dryRun ? 'rehearsed' : 'observed';
    }
    try {
      if (hooks.beforeRun) context.before = fetch(hooks.beforeRun);
      workflow.steps.forEach(function (step) {
        io.log('step_started', { id: step.id, name: step.name });
        var a = step.action;
        if (a.type === 'wake') io.wake();
        else if (a.type === 'launch') io.launch();
        else if (a.type === 'wait') io.sleep(a.ms);
        else if (a.type === 'back') io.back();
        else if (a.type === 'wechat_home') home();
        else if (a.type === 'wechat_first_chat') { chat = openFirst(); outputs[a.output] = chat; }
        else if (a.type === 'wechat_open_chat') { chat = openNamed(a.target); outputs[a.output] = chat; }
        else if (a.type === 'wechat_send_text') {
          if (!chat) fail('没有已核对的接收会话');
          var attempted = false;
          try { send(chat, a.text, dryRun, function () { attempted = true; }); }
          catch (e) { if (attempted) outputs.message_status = 'uncertain'; throw e; }
          outputs.message_status = dryRun ? 'rehearsed' : 'observed';
        } else if (a.type === 'wechat_broadcast') batch(config.input);
        else if (a.type === 'tap') {
          if (dryRun && workflow.steps.some(function (s) { return ['wechat_send_text', 'wechat_broadcast'].indexOf(s.action.type) >= 0; })) fail('发送预演不允许额外自定义点击');
          tap(a.selector, a.skip_if, a.recover_back);
        } else if (a.type === 'read_row') {
          var s = observe('完整读取个人信息页面的昵称。');
          if (s.page !== 'profile' || [a.page, '个人信息', '个人资料'].indexOf(s.title) < 0) fail('当前不是个人信息页面');
          var found = s.items.filter(function (i) { return i.role === 'row' && i.complete && a.labels.indexOf(i.text) >= 0 && typeof i.value === 'string' && i.value.trim(); });
          if (found.length !== 1) fail('不能唯一读取昵称');
          outputs[a.output] = found[0].value;
        }
        io.log('step_completed', { id: step.id, name: step.name }); persist();
      });
      status = 'completed';
    } catch (e) { status = 'failed'; error = String(e.message || e); }
    context.run.status = status; context.outputs = outputs; delete context.recipient;
    context.result = { status: status, error: error, targets: deliveries.length, completed: deliveries.filter(function (d) { return ['sent', 'rehearsed'].indexOf(d.status) >= 0; }).length };
    if (hooks.afterRun) { try { fetch(hooks.afterRun); } catch (e) { status = 'failed'; error = (error ? error + '\n' : '') + '结束请求失败：' + String(e.message || e); } }
    persist();
    if (error) fail(error);
    return outputs;
  }
  return { run: run, discover: discover, observe: observe };
}
module.exports = { create: create, validateScreen: screen, validateInput: input, validateMessage: message, sameTitle: same, mergeNames: merge };
