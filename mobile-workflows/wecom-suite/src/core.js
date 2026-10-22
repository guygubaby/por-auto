// GENERATED from mobile-workflows/shared/src/core.js
'use strict';

function fail(message) { throw new Error(message); }
function object(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function key(name) { return String(name).replace(/\s/g, '').replace(/（/g, '(').replace(/）/g, ')').replace(/[｜丨]/g, '|').replace(/(?:…|\.{3}|·{3})/g, '…'); }
function same(actual, expected) {
  var a = key(actual), b = key(expected);
  if (a.indexOf('…') >= 0 || b.indexOf('…') >= 0) return false;
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
  if (value.page === 'other' && value.title === '安全保护中') fail('企业微信要求账号本人完成验证，当前流程已停止，未重试发送');
  return value;
}
function unique(s, role) {
  var items = s.items.filter(function (i) { return i.complete && i.role === role; });
  if (items.length !== 1) fail('不能唯一确认页面入口：' + role);
  return items[0];
}
function names(s, page, roles) {
  if (s.page !== page) fail('页面已离开会话列表');
  roles = roles || ['chat', 'group'];
  var rows = s.items.filter(function (i) { return roles.indexOf(i.role) >= 0; }).sort(function (a, b) { return a.point[1] - b.point[1] || a.point[0] - b.point[0]; });
  if (!rows.length && !s.listEmpty) fail('不能确认列表为空，未开始处理');
  var seen = [], result = [];
  rows.forEach(function (i) {
    if (!i.complete || !i.text.trim() || /…|\.\.\.$/.test(i.text)) fail('会话列表中的名称没有完整显示，未猜测或发送');
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
function checkChat(s, title) {
  if (s.page !== 'chat' || !same(s.title, title)) fail('当前页面不能确认为目标会话「' + title + '」');
}
function targetChecked(s, title) {
  checkChat(s, title);
  return s;
}
function confirmStableDraft(title, text, observe) {
  for (var attempt = 0; attempt < 3; attempt++) {
    var current = observe(), value = screen(current.screen); checkChat(value,title);
    if (!value.editor || value.editor.text !== text) fail('草稿内容已变化，未发送或清理');
    if (current.unchanged === true) return value;
  }
  fail('页面持续变化，未发送或清理草稿');
}
function recipientCategories(value) {
  return !!object(value) && typeof value.direct === 'boolean' && typeof value.groups === 'boolean';
}
function recipientPlan(categories, groups, conversations) {
  if (!recipientCategories(categories) || (!categories.direct && !categories.groups)) fail('至少选择单聊或群聊');
  var groupKeys = Object.create(null), seen = Object.create(null), result = [];
  groups.forEach(function (title) { groupKeys[key(title)] = true; });
  function add(title, scope) {
    var id = scope + ':' + key(title);
    if (seen[id]) return;
    if (result.length >= 2000) fail('本轮超过 2000 个会话，请分批处理');
    seen[id] = true; result.push({ title: title, scope: scope });
  }
  if (categories.groups) groups.forEach(function (title) { add(title, 'groups'); });
  if (categories.direct) conversations.forEach(function (title) { if (!groupKeys[key(title)]) add(title, 'conversations'); });
  return result;
}
function input(value) {
  if (!object(value) || !object(value.recipients)
      || typeof value.intervalMs !== 'number' || value.intervalMs % 1 || value.intervalMs < 500 || value.intervalMs > 600000) fail('请先配置消息、接收范围与间隔');
  if (recipientCategories(value.recipients)) {
    recipientPlan(value.recipients, [], []);
  } else {
    // Existing pinned schedules retain their approved recipient scope.
    if (['groups', 'conversations'].indexOf(value.recipients.scope) < 0 || ['all', 'selected'].indexOf(value.recipients.mode) < 0 || !Array.isArray(value.recipients.names) || value.recipients.names.length > 2000) fail('请先勾选单聊或群聊');
    var seen = [];
    value.recipients.names.forEach(function (n) { if (typeof n !== 'string' || !n.trim() || n.length > 200 || /[\x00-\x1f]/.test(n) || seen.indexOf(key(n)) >= 0) fail('接收会话名称无效或重复'); seen.push(key(n)); });
    if (value.recipients.mode === 'selected' && !seen.length) fail('请至少选择一个接收会话');
  }
  if (!object(value.message) || ['manual', 'http', 'before_run'].indexOf(value.message.type) < 0) fail('消息来源无效');
  if (value.message.type === 'manual') message(value.message.text);
  if (value.message.type === 'http' && ['run', 'recipient'].indexOf(value.message.refresh) < 0) fail('请选择每轮或每个会话获取消息');
  return value;
}

function fields(value, allowed) {
  if (!object(value) || Object.keys(value).some(function (name) { return allowed.indexOf(name) < 0; })) fail('工作流包含未知字段或无效对象');
}
function identifier(value) { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value); }
function shortText(value) { return typeof value === 'string' && !!value.trim() && unescape(encodeURIComponent(value)).length <= 500 && value.indexOf('\0') < 0; }
function integer(value, min, max) { return typeof value === 'number' && value % 1 === 0 && value >= min && value <= max; }
function selector(value) {
  fields(value, ['text', 'prefix', 'bottom', 'peers']);
  var count = 0;
  ['text', 'prefix', 'peers'].forEach(function (name) {
    if (value[name] === undefined) return;
    if (!Array.isArray(value[name]) || value[name].length > 10 || !value[name].every(shortText)) fail('工作流页面选择器无效');
    if (name !== 'peers') count += value[name].length;
  });
  if (!count || count > 10 || value.bottom !== undefined && typeof value.bottom !== 'boolean') fail('工作流页面选择器无效');
}
function validateWorkflow(workflow) {
  fields(workflow, ['schemaVersion', 'minEngine', 'id', 'name', 'version', 'description', 'package', 'steps', 'inputSchema']);
  if (workflow.schemaVersion !== 1 || !integer(workflow.minEngine, 1, 5)) fail('工作流格式或版本不受支持');
  if (workflow.package !== 'com.tencent.wework') fail('不支持目标应用');
  if (!identifier(workflow.id) || !shortText(workflow.name) || typeof workflow.description !== 'string' || workflow.description.length > 2000
      || typeof workflow.version !== 'string' || workflow.version.length > 80 || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(workflow.version)
      || !Array.isArray(workflow.steps) || !workflow.steps.length || workflow.steps.length > 40) fail('工作流名称、版本或步骤数量无效');
  var prerelease = workflow.version.split('+')[0].split('-').slice(1).join('-');
  if (prerelease && prerelease.split('.').some(function (part) { return /^0\d+$/.test(part); })) fail('工作流版本不是有效 SemVer');
  var actions = {
    wake: [], launch: ['activity'], wait: ['ms'], back: [],
    tap: ['selector', 'skip_if', 'recover_back'], read_row: ['page', 'labels', 'output'],
    chat_home: [], chat_profile: ['output'], chat_first_chat: ['output'],
    chat_open_chat: ['target', 'output'], chat_send_text: ['text'], chat_broadcast: []
  };
  var ids = Object.create(null), outputs = Object.create(null), sends = 0, totalWait = 0, chat = false, batch = false;
  function output(name) {
    if (!identifier(name) || outputs[name] || ['__proto__', 'constructor', 'prototype', 'before_hook', 'after_hook'].indexOf(name) >= 0) fail('工作流输出字段无效或重复');
    outputs[name] = true;
  }
  workflow.steps.forEach(function (step) {
    fields(step, ['id', 'name', 'action']);
    if (!shortText(step.name)) fail('工作流步骤名称无效');
    if (step.id !== undefined) {
      if (!identifier(step.id) || ids[step.id]) fail('步骤 ID 无效或重复');
      ids[step.id] = true;
    }
    var a = step.action;
    if (!object(a) || typeof a.type !== 'string' || !Object.prototype.hasOwnProperty.call(actions, a.type)) fail('未知工作流动作');
    fields(a, ['type'].concat(actions[a.type]));
    if (a.type.indexOf('chat_') === 0 && workflow.minEngine < 4) fail('原生聊天动作需要引擎 4');
    if (['chat_first_chat', 'chat_open_chat', 'chat_send_text', 'wait'].indexOf(a.type) < 0) chat = false;
    if (a.type === 'chat_first_chat' || a.type === 'chat_open_chat') {
      if (a.type === 'chat_open_chat' && !shortText(a.target)) fail('指定会话名称无效');
      output(a.output); chat = true;
    } else if (a.type === 'chat_send_text' || a.type === 'chat_broadcast') {
      if (++sends > 1) fail('每个工作流只能有一个发送动作');
      if (a.type === 'chat_send_text') {
        if (!chat || !shortText(a.text)) fail('发送文字需要先确认会话，内容最多 500 字节');
        message(a.text);
      } else { batch = true; output('target_count'); }
      output('message_status');
    } else if (a.type === 'launch') {
      if (typeof a.activity !== 'string' || !/^[A-Za-z0-9_.]{1,200}$/.test(a.activity)) fail('启动组件无效');
    } else if (a.type === 'wait') {
      if (!integer(a.ms, 0, 10000)) fail('单步等待不能超过 10 秒');
      totalWait += a.ms;
    } else if (a.type === 'tap') {
      selector(a.selector);
      if (a.recover_back !== undefined && !integer(a.recover_back, 0, 3)) fail('工作流页面恢复次数超出限制');
      if (a.skip_if !== undefined) {
        if (!Array.isArray(a.skip_if) || a.skip_if.length > 5) fail('工作流跳过条件无效');
        a.skip_if.forEach(selector);
      }
    } else if (a.type === 'chat_profile') output(a.output);
    else if (a.type === 'read_row') {
      if (!shortText(a.page) || !Array.isArray(a.labels) || !a.labels.length || a.labels.length > 10 || !a.labels.every(shortText)) fail('工作流读取条件无效');
      output(a.output);
    }
  });
  if (totalWait > 30000) fail('工作流总等待时间不能超过 30 秒');
  if (batch) {
    fields(workflow.inputSchema, ['$ref']);
    if (workflow.inputSchema.$ref !== 'por-auto://schemas/chat-send-input/v1') fail('工作流输入 Schema 不受支持');
  } else if (workflow.inputSchema != null) fail('此工作流不接受输入 Schema');
  return workflow;
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
        var result = screen(value);
        if (io.package !== 'com.tencent.wework') invalidObservation('目标应用不是企业微信，未继续操作');
        return result;
      } catch (error) {
        if (attempt >= 2 || error.code !== 'INVALID_OBSERVATION') throw error;
        io.log('observation_rejected', '页面格式或坐标无效，重新读取，未执行操作'); io.sleep(800);
      }
    }
  }
  function click(p) { if (!point(p)) fail('点击坐标无效'); io.click(p); io.sleep(800); }
  function header(s,role){if(io.clickHeader){io.clickHeader(role);io.sleep(800);}else click(unique(s,role).point);}
  function transitioned(matches,waiting,hint){
    for(var attempt=0;attempt<4;attempt++){
      var s=observe(hint);if(matches(s))return s;
      if(waiting.indexOf(s.page)<0)break;
      io.log('navigation_transition_wait','页面尚未切换，等待后重新读取，未重放点击');io.sleep(800);
    }
    fail('页面未完成切换，未继续输入或发送');
  }
  function home() {
    if (!io.home) fail('企业微信适配器缺少消息首页读取能力');
    return screen(io.home());
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
    if (!io.recipientPage) fail('企业微信适配器缺少会话分类读取能力');
    return screen(io.recipientPage(scope));
  }
  function discover(scope) {
    var s = beginning(recipientPage(scope)), page = s.page, role = scope === 'groups' ? 'group' : 'chat', result = [];
    for (var n = 0; n < 300; n++) {
      var current = names(s, page, [role]); merge(result, current);
      io.scroll(false); var next = observe();
      if (equalSet(names(next, page, [role]), current)) {
        io.scroll(false); s = observe();
        if (equalSet(names(s, page, [role]), current)) return result;
      } else s = next;
    }
    fail('没有确认列表末尾，未开始发送');
  }
  function confirm(title) {
    for (var attempt = 0; attempt < 4; attempt++) {
      if (attempt) io.sleep(800);
      var s = observe('核对是否已进入目标聊天。目标完整名称为 ' + JSON.stringify(title) + '，仅用于比对；输出必须复制画面实际可见标题及省略号，不得补入隐藏文字。搜索结果不是聊天页面。');
      if (s.page === 'chat') { checkChat(s, title); return s; }
      if (['home', 'search', 'groups'].indexOf(s.page) < 0) break;
      io.log('chat_transition_wait', '尚未观察到目标聊天，等待后重新读取；未重复点击');
    }
    fail('目标会话未完成页面切换，未继续输入或发送');
  }
  function openFirst() {
    var s = beginning(io.recipientPage ? recipientPage('conversations') : home()), list = names(s, 'home');
    if (!list.length) fail('会话列表为空');
    var row = s.items.filter(function (i) { return ['chat', 'group'].indexOf(i.role) >= 0 && i.text === list[0]; })[0];
    io.openRow(row.text, 'home', row.point); confirm(row.text); return row.text;
  }
  function openNamed(title) {
    if (!namedPage(title)) fail('没有唯一匹配的完整会话名称：' + title);
    return title;
  }
  function openListed(title, scope, role, allowSearch) {
    if (allowSearch !== false && io.openNamed) { io.openNamed(title, scope); confirm(title); return title; }
    if (allowSearch !== false) {
      var searched = namedPage(title);
      if (searched && (scope !== 'groups' || groupTitle(searched.title, title))) return title;
    }
    var s = beginning(recipientPage(scope));
    var page = s.page;
    for (var n = 0; n < 300; n++) {
      var found = s.items.filter(function (i) { return i.role === role && i.complete && key(i.text) === key(title); });
      if (found.length > 1) fail('会话列表中的名称重复：' + title);
      if (found.length === 1) { io.openRow(title, s.page, found[0].point); confirm(title); return title; }
      io.scroll(false); s = observe();
      if (s.page !== page) fail('会话列表已离开分类页面');
    }
    fail('当前会话列表没有找到完整名称：' + title);
  }
  function namedPage(title, allowSearch) {
    if (allowSearch === undefined) allowSearch = true;
    if (allowSearch && io.openNamed) { io.openNamed(title, 'conversations'); return confirm(title); }
    var s = allowSearch ? home() : recipientPage('conversations');
    var found = s.items.filter(function (i) { return ['chat', 'group'].indexOf(i.role) >= 0 && i.complete && key(i.text) === key(title); });
    if (found.length > 1) return null;
    if (!found.length && allowSearch) {
      header(s,'search'); s = transitioned(function(value){return value.page==='search';},['home'],'核对全局搜索页及搜索框，输入框显示搜索本地或网络结果时 value 为空字符串。');
      if (s.page !== 'search') fail('没有确认企业微信全局搜索页，未输入');
      var search = unique(s, 'search_input');
      if (search.value !== '') fail('搜索框已有内容或无法读取，未覆盖');
      io.type(title, search.point); io.sleep(800);
      s = observe('精确定位本地搜索结果 ' + JSON.stringify(title) + '，不要选择搜索框或网络建议。');
      if (s.page !== 'search') fail('搜索内容未能核对');
      var fields = s.items.filter(function (i) { return i.complete && i.role === 'search_input'; });
      if (fields.length !== 1 || fields[0].value !== title) {
        var local = s.items.filter(function (i) { return ['chat', 'group'].indexOf(i.role) >= 0 && i.complete && key(i.text) === key(title); });
        if (fields.length || local.length !== 1) fail('搜索内容未能核对');
      }
      found = s.items.filter(function (i) { return ['chat', 'group'].indexOf(i.role) >= 0 && i.complete && key(i.text) === key(title); });
    }
    if (found.length !== 1) return null;
    io.openRow(title, s.page, found[0].point); return confirm(title);
  }
  function openGroup(title) {
    return openListed(title, 'groups', 'group', true);
  }
  var categoryScope = null, categoryList = null;
  function openCategory(title, scope) {
    var role = scope === 'groups' ? 'group' : 'chat';
    if (categoryScope !== scope) {
      categoryList = beginning(recipientPage(scope));
      categoryScope = scope;
    } else {
      io.back(); io.sleep(650);
      categoryList = observe('返回全量会话列表后继续处理下一个对象。');
    }
    for (var pass = 0; pass < 2; pass++) {
      if (pass) categoryList = beginning(categoryList);
      var page = categoryList.page;
      for (var n = 0; n < 300; n++) {
        var found = categoryList.items.filter(function (i) { return i.role === role && i.complete && key(i.text) === key(title); });
        if (found.length > 1) fail('会话列表中的名称重复：' + title);
        if (found.length === 1) { io.openRow(title, page, found[0].point); confirm(title); return title; }
        io.scroll(false); categoryList = observe();
        if (categoryList.page !== page) fail('会话列表已离开分类页面');
      }
    }
    fail('当前会话列表没有找到完整名称：' + title);
  }
  function send(title, text, dryRun, intent) {
    message(text);
    var s = targetChecked(observe(), title);
    if (io.ensureEditor) { s=targetChecked(screen(io.ensureEditor(title)),title); }
    else if (!s.editor) { click(unique(s, 'keyboard').point); s = targetChecked(observe(), title); }
    if (!s.editor) fail('无法确认文字输入框');
    if (dryRun && s.editor.text === text) { io.log('draft_verified', { title: title, retained: true }); return; }
    if (s.editor.text !== '') fail('会话有已有草稿或无法完整读取，未覆盖');
    io.type(text, s.editor.point, title); s = targetChecked(observe('精确核对聊天标题和输入框的完整文字。'), title);
    if (!s.editor || s.editor.text !== text) fail('输入内容未能精确核对，未发送，请检查手机草稿');
    io.log('draft_verified', { title: title });
    if (dryRun) {
      io.beforeCommit(s.editor.point, title, text);
      io.clear(text, s.editor.point); s = targetChecked(observe(), title);
      if (s.editor && s.editor.text !== '') fail('预演草稿清理未能确认，未发送');
      return;
    }
    var button = unique(s, 'send');
    if (button.text !== '发送' || button.point[0] <= s.editor.point[0] || Math.abs(button.point[1] - s.editor.point[1]) > 120) fail('不能确认发送按钮');
    var count = s.outgoing.filter(function (b) { return b.text === text && !b.pending && !b.failed; }).length;
    io.beforeCommit(s.editor.point, title, text);
    intent(); io.log('send_requested', { title: title }); click(button.point);
    var after = targetChecked(observe(), title);
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
    validateWorkflow(workflow);
    var request = require('./request.js'), outputs = {}, deliveries = [], status = 'running', error = null;
    var dryRun = config.dryRun !== false, hooks = config.hooks || {};
    var context = { run: { id: io.runId, mode: dryRun ? 'rehearsal' : 'send', status: status }, workflow: { id: workflow.id, name: workflow.name, version: workflow.version } };
    if (io.serial) context.device = { serial: io.serial };
    context.outputs = outputs; context.run.error = null;
    var chat = null, prepared = null, preparedAt = null, startedAt = io.now();
    function fetch(spec) { return request.fetch(spec, context, io); }
    function persist() { io.record({ schemaVersion: 1, runId: io.runId, startedAt: startedAt, finishedAt: status === 'running' ? null : io.now(), status: status, error: error, dryRun: dryRun, workflow: workflow.id, workflowName: workflow.name, workflowVersion: workflow.version, outputs: outputs, targets: deliveries }); }
    function batch(value) {
      input(value);
      if (value.message.type === 'manual') prepared = message(value.message.text);
      else if (value.message.type === 'before_run') { prepared = message(context.before && context.before.message); preparedAt = context.before.fetchedAt; }
      else if (value.message.refresh === 'run') { var initial = fetch(value.message.request); prepared = initial.message; preparedAt = initial.fetchedAt; }
      var categorical = recipientCategories(value.recipients), plan;
      if (categorical) {
        var groups = discover('groups');
        var conversations = value.recipients.direct ? discover('conversations') : [];
        plan = recipientPlan(value.recipients, groups, conversations);
      } else {
        var listed = discover(value.recipients.scope);
        var legacy = value.recipients.mode === 'all' ? listed : value.recipients.names.map(function (name) {
          var matches = listed.filter(function (n) { return key(n) === key(name); });
          if (matches.length !== 1) fail('指定会话「' + name + '」不在当前列表或重名，未开始处理');
          return matches[0];
        });
        plan = legacy.map(function (title) { return { title: title, scope: value.recipients.scope }; });
      }
      var targets = plan.map(function (entry) { return entry.title; });
      if (!targets.length) fail('没有可处理的接收会话');
      deliveries = plan.map(function (entry) { return { title: entry.title, scope: entry.scope, status: 'pending', error: null }; }); persist();
      for (var index = 0; index < targets.length; index++) {
        var target = deliveries[index], attempted = false;
        context.recipient = { title: target.title, index: index + 1, total: targets.length };
        target.status = dryRun ? 'rehearsing' : 'opening'; persist();
        try {
          if (categorical) openCategory(target.title, plan[index].scope);
          else if (plan[index].scope === 'groups') openGroup(target.title);
          else openNamed(target.title);
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
        else if (a.type === 'launch') io.launch(a.activity);
        else if (a.type === 'wait') io.sleep(a.ms);
        else if (a.type === 'back') io.back();
        else if (a.type === 'chat_profile') { if (!io.nickname) fail('当前适配器不能读取姓名'); outputs[a.output] = io.nickname(); }
        else if (a.type === 'chat_home') home();
        else if (a.type === 'chat_first_chat') { chat = openFirst(); outputs[a.output] = chat; }
        else if (a.type === 'chat_open_chat') { chat = openNamed(a.target); outputs[a.output] = chat; }
        else if (a.type === 'chat_send_text') {
          if (!chat) fail('没有已核对的接收会话');
          var attempted = false;
          try { send(chat, a.text, dryRun, function () { attempted = true; }); }
          catch (e) { if (attempted) outputs.message_status = 'uncertain'; throw e; }
          outputs.message_status = dryRun ? 'rehearsed' : 'observed';
        } else if (a.type === 'chat_broadcast') batch(config.input);
        else if (a.type === 'tap') {
          if (dryRun && workflow.steps.some(function (s) { return ['chat_send_text', 'chat_broadcast'].indexOf(s.action.type) >= 0; })) fail('发送预演不允许额外自定义点击');
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
    context.run.status = status; context.run.error = error; context.outputs = outputs; delete context.recipient;
    context.result = { status: status, error: error, targets: deliveries.length, completed: deliveries.filter(function (d) { return ['sent', 'rehearsed'].indexOf(d.status) >= 0; }).length };
    if (hooks.afterRun) { try { fetch(hooks.afterRun); } catch (e) { status = 'failed'; error = (error ? error + '\n' : '') + '结束请求失败：' + String(e.message || e); } }
    persist();
    if (error) fail(error);
    return outputs;
  }
  return { run: run, discover: discover, observe: observe };
}
module.exports = { create: create, confirmStableDraft: confirmStableDraft, validateScreen: screen, validateInput: input, validateMessage: message, validateWorkflow: validateWorkflow, sameTitle: same, mergeNames: merge, recipientCategories: recipientCategories, recipientPlan: recipientPlan };
