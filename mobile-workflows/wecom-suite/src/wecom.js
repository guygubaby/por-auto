'use strict';

var PACKAGE = 'com.tencent.wework';
function fail(message) { throw new Error(message); }
function exactDraft(screen, title, text) {
  return screen.page === 'chat' && require('./core.js').sameTitle(screen.title, title)
    && !!screen.editor && screen.editor.text === text;
}
function homeReady(nodes, width) {
  function matches(id) { return nodes.filter(function (n) { return n.id === id && n.visible && n.enabled && n.bounds[2] > n.bounds[0] && n.bounds[3] > n.bounds[1]; }); }
  var titles = matches('ncq'), lists = matches('czp'), filters = matches('fg8');
  return titles.length === 1 && titles[0].text === '消息' && lists.length === 1
    && lists[0].bounds[0] === 0 && lists[0].bounds[2] === width && filters.length === 1;
}
function create(por, config) {
  var io = require('./android.js').create(por, config), ownedAwake = false;
  var scope = 'conversations', last = null, lastTitle = null, commit = null;
  function foreground() {
    io.requireAccessibility();
    if (context.getSystemService(android.content.Context.KEYGUARD_SERVICE).isKeyguardLocked()) fail('手机已锁屏，请先解锁');
    if (io.focusedPackage() !== PACKAGE) fail('企业微信不在前台，已停止');
  }
  function tree() {
    foreground(); var kept = [], nodes = [], windows = auto.service.getWindows();
    try {
      for (var w = 0; w < windows.size(); w++) {
        var win = windows.get(w); if (!win.isFocused() || win.getType() !== 1) continue;
        var root = win.getRoot(); if (!root) continue; kept.push(root);
        if (String(root.getPackageName()) !== PACKAGE) fail('前台窗口不是企业微信');
        var queue = [{ native: root, parent: -1 }];
        for (var n = 0; n < queue.length; n++) {
          if (n >= 4000) fail('企业微信控件数量超过读取限制');
          var raw = queue[n].native, b = new android.graphics.Rect();
          if (!raw.refresh()) fail('页面控件已经失效，请重新运行');
          raw.getBoundsInScreen(b);
          nodes.push({ index: n, parent: queue[n].parent, id: String(raw.getViewIdResourceName() || '').replace(PACKAGE + ':id/', ''),
            text: String(raw.getText() || ''), hint: android.os.Build.VERSION.SDK_INT >= 26 ? !!raw.isShowingHintText() : null,
            bounds: [b.left, b.top, b.right, b.bottom], visible: !!raw.isVisibleToUser(), enabled: !!raw.isEnabled(),
            editable: !!raw.isEditable(), password: !!raw.isPassword(), clickable: !!raw.isClickable(), scrollable: !!raw.isScrollable() });
          for (var c = 0; c < raw.getChildCount(); c++) { var child = raw.getChild(c); if (child) { kept.push(child); queue.push({ native: child, parent: n }); } }
        }
        break;
      }
      if (!nodes.length) fail('企业微信未返回原生页面控件');
      return nodes;
    } finally { kept.forEach(function (n) { try { n.recycle(); } catch (_) {} }); }
  }
  function valid(n) { return n.visible && n.enabled && n.bounds[2] > n.bounds[0] && n.bounds[3] > n.bounds[1]; }
  function one(nodes, id) { var found = nodes.filter(function (n) { return n.id === id && valid(n); }); if (found.length !== 1) fail('无法唯一确认企业微信控件：' + id); return found[0]; }
  function under(nodes, node, parent) { for (var n = node; n && n.parent >= 0; n = nodes[n.parent]) if (n.parent === parent.index) return true; return false; }
  function point(n) { return [Math.max(1, Math.min(999, Math.floor((n.bounds[0] + n.bounds[2]) * 500 / device.width))), Math.max(1, Math.min(999, Math.floor((n.bounds[1] + n.bounds[3]) * 500 / device.height)))]; }
  function rawAction(id, action, value) {
    foreground(); var roots = auto.service.getWindows(), kept = [], found = [];
    try {
      for (var w = 0; w < roots.size(); w++) {
        if (!roots.get(w).isFocused() || roots.get(w).getType() !== 1) continue;
        var root = roots.get(w).getRoot(); if (!root) continue; kept.push(root);
        if (String(root.getPackageName()) !== PACKAGE) fail('前台窗口已变化');
        var matches = root.findAccessibilityNodeInfosByViewId(PACKAGE + ':id/' + id);
        for (var i = 0; i < matches.size(); i++) { var n = matches.get(i); kept.push(n); if (n.refresh() && n.isVisibleToUser() && n.isEnabled()) found.push(n); }
      }
      if (found.length !== 1) fail('原生操作目标不唯一：' + id);
      var node = found[0], args = null;
      if (action === android.view.accessibility.AccessibilityNodeInfo.ACTION_SET_TEXT) {
        if (!node.isEditable() || node.isPassword() || android.os.Build.VERSION.SDK_INT < 26) fail('当前不是可核对的聊天编辑框');
        var current = node.isShowingHintText() ? '' : String(node.getText() || '');
        if (current !== value.expected) fail('草稿已变化，未覆盖或清理');
        args = new android.os.Bundle(); args.putCharSequence(android.view.accessibility.AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value.text);
      }
      return !!node.performAction(action, args);
    } finally { kept.forEach(function (n) { try { n.recycle(); } catch (_) {} }); }
  }
  var ACTION = android.view.accessibility.AccessibilityNodeInfo;
  function clickId(id) { if (!rawAction(id, ACTION.ACTION_CLICK)) fail('原生点击未完成：' + id); sleep(650); }
  function rows(nodes) {
    var list = one(nodes, 'czp'), result = [], seen = [];
    nodes.filter(function (n) { return n.id === 'hrr' && valid(n) && under(nodes, n, list); }).forEach(function (n) {
      var row = n; while (row.parent >= 0 && row.parent !== list.index) row = nodes[row.parent];
      if (!row.clickable || row.bounds[1] < list.bounds[1] || row.bounds[3] > list.bounds[3]) return;
      if (!n.text.trim() || /…|\.\.\.$/.test(n.text)) fail('会话名称不完整，未猜测');
      if (scope !== 'groups' && ['接收微信中的工作消息', '打卡', '企业微信团队', '我的客服', '添加管理员协助你体验'].indexOf(n.text) >= 0) return;
      if (seen.indexOf(n.text) >= 0) fail('会话重名，无法安全区分');
      seen.push(n.text); result.push({ role: scope === 'groups' ? 'group' : 'chat', text: n.text, point: point(n), complete: true, value: null });
    });
    return result;
  }
  function observe() {
    var nodes = tree(), titles = nodes.filter(function (n) { return n.id === 'ncq' && valid(n); });
    var s = { certain: true, page: 'other', title: titles.length === 1 ? titles[0].text : '', items: [], editor: null, outgoing: [], listEmpty: false };
    var editors = nodes.filter(function (n) { return n.id === 'i_6' && valid(n); });
    if (editors.length === 1) {
      var editor = editors[0]; if (editor.hint === null || !editor.editable || editor.password) fail('无法核对真实草稿与提示语');
      s.page = 'chat'; s.editor = { point: point(editor), text: editor.hint ? '' : editor.text };
      nodes.filter(function (n) { return valid(n) && n.text === '发送' && n.bounds[0] >= editor.bounds[2] && n.bounds[1] < editor.bounds[3] && n.bounds[3] > editor.bounds[1]; }).forEach(function (n) { s.items.push({ role: 'send', text: '发送', point: point(n), complete: true, value: null }); });
      nodes.filter(function (n) { return valid(n) && n.id === 'i_d' && n.bounds[0] > device.width / 2; }).forEach(function (n) { s.outgoing.push({ text: n.text, pending: false, failed: false }); });
    } else if (homeReady(nodes, device.width)) {
      s.page = scope === 'groups' ? 'groups' : 'home'; s.items = rows(nodes); s.listEmpty = !s.items.length;
    }
    last = { screen: s, nodes: nodes }; return s;
  }
  function home() {
    for (var n = 0; n < 8; n++) {
      scope = 'conversations'; var s = observe();
      if (s.page === 'home') return s;
      var tabs = last.nodes.filter(function (n) { return n.id === 'hrr' && n.bounds[1] > device.height * .75 && valid(n); });
      var first = tabs.filter(function (n) { return n.text === '消息'; });
      if (first.length === 1 && ['消息','邮件','文档','工作台','通讯录'].every(function (name) { return tabs.some(function (n) { return n.text === name; }); })) {
        if (!click(Math.floor((first[0].bounds[0] + first[0].bounds[2]) / 2), Math.floor((first[0].bounds[1] + first[0].bounds[3]) / 2))) fail('无法切回消息导航');
      } else if (!back()) fail('返回消息首页失败');
      for (var wait = 0; wait < 4; wait++) {
        sleep(350); var next = observe(); if (next.page === 'home') return next;
      }
    }
    fail('未能返回企业微信消息首页');
  }
  function recipientPage(value) {
    home(); var desired = value === 'groups' ? '群聊' : '全部';
    if (one(tree(), 'fg8').text !== desired) {
      clickId('fg9'); var options = tree().filter(function (n) { return valid(n) && n.text === desired; });
      if (options.length !== 1) fail('会话分类不唯一');
      var p = options[0].bounds; if (!click(Math.floor((p[0]+p[2])/2), Math.floor((p[1]+p[3])/2))) fail('会话分类点击失败'); sleep(650);
    }
    if (one(tree(), 'fg8').text !== desired) fail('会话分类未完成切换');
    scope = value; return observe();
  }
  function scroll(up) {
    var s = observe(); if (['home','groups'].indexOf(s.page) < 0) fail('会话列表尚未稳定，未滚动');
    if (!one(last.nodes,'czp').scrollable) return false;
    var moved = rawAction('czp', up ? ACTION.ACTION_SCROLL_BACKWARD : ACTION.ACTION_SCROLL_FORWARD); sleep(400); return moved;
  }
  function openRow(title, page, p) {
    var s = observe(); if (s.page !== page) fail('会话列表已变化');
    var matches = s.items.filter(function (item) { return item.text === title; }); if (matches.length !== 1) fail('会话行不唯一');
    var nodes = last.nodes, list = one(nodes,'czp'), titleNode = nodes.filter(function (n) { return n.id === 'hrr' && n.text === title && valid(n) && under(nodes,n,list); });
    if (titleNode.length !== 1) fail('会话名称已变化');
    var row = titleNode[0]; while (row.parent >= 0 && row.parent !== list.index) row = nodes[row.parent];
    var b = row.bounds; if (!click(Math.floor((b[0]+b[2])/2), Math.floor((b[1]+b[3])/2))) fail('打开会话失败'); sleep(650); lastTitle = title;
  }
  function openNamed(title, value) {
    home(); clickId('ndh');
    var input = one(tree(),'lba');
    if (input.hint !== true && input.text) fail('搜索框已有内容，未覆盖');
    if (!rawAction('lba',ACTION.ACTION_SET_TEXT,{ expected: '', text: title })) fail('原生搜索输入未完成');
    sleep(650); var nodes = tree();
    if (one(nodes,'lba').text !== title) fail('搜索内容未能核对');
    if (value === 'groups') {
      var tabs = one(nodes,'n5o'), groups = nodes.filter(function(n){return n.parent===tabs.index&&valid(n)&&n.text==='群聊';});
      if(groups.length!==1)fail('无法唯一确认搜索的群聊分类');
      var b=groups[0].bounds;if(!click(Math.floor((b[0]+b[2])/2),Math.floor((b[1]+b[3])/2)))fail('搜索分类未完成');sleep(650);nodes=tree();
    }
    var resultList=one(nodes,'km_'),found=nodes.filter(function(n){return n.id==='mid1Txt'&&n.text===title&&valid(n)&&under(nodes,n,resultList);});
    if(found.length>1)fail('搜索到同名会话，未点击');
    if(found.length===1){
      var row=found[0];while(!row.clickable&&row.parent>=0&&row.parent!==resultList.index)row=nodes[row.parent];
      if(!row.clickable)fail('搜索会话没有可验证的行入口');
      var bounds=row.bounds;if(!click(Math.floor((bounds[0]+bounds[2])/2),Math.floor((bounds[1]+bounds[3])/2)))fail('打开搜索结果未完成');
      lastTitle=title;sleep(650);return;
    }
    var s = recipientPage(value);
    for (var n = 0; n < 300; n++) { if (!scroll(true)) break; s = observe(); }
    for (var i = 0; i < 300; i++) {
      s = observe(); if (s.items.some(function (item) { return item.text === title; })) { openRow(title,s.page); return; }
      if (!scroll(false)) break;
    }
    fail('当前会话列表没有找到完整名称：' + title);
  }
  function sameChat(title, actual) { return require('./core.js').sameTitle(actual,title); }
  function edit(expected, text) {
    var s = observe(); if (s.page !== 'chat' || !lastTitle || !sameChat(lastTitle,s.title) || !s.editor || s.editor.text !== expected) fail('会话或草稿已变化，未修改');
    if (!rawAction('i_6',ACTION.ACTION_SET_TEXT,{ expected: expected, text: text })) fail('原生文字输入未完成'); sleep(250);
  }
  io.package = PACKAGE;
  delete io.clickHeader;
  io.prepare = function () {
    io.requireAccessibility();
    if (por.screenSession) por.screenSession.check();
    else if (!ownedAwake) { device.keepScreenDim(); ownedAwake = true; }
  };
  io.finish = function () { if (ownedAwake) { ownedAwake = false; device.cancelKeepingAwake(); } };
  io.launch = function () { if (!app.launchPackage(PACKAGE)) fail('请先安装并登录企业微信'); sleep(1000); };
  io.observe = observe; io.home = home; io.recipientPage = recipientPage; io.openNamed = openNamed; io.openRow = openRow; io.scroll = scroll;
  io.ensureEditor = function(title) { var s=observe();if(s.page!=='chat'||!sameChat(title,s.title)||!s.editor)fail('没有确认目标会话的原生文字输入框');return s; };
  io.back = function () { foreground(); if (!back()) fail('返回操作未完成'); };
  io.type = function (text, p, title) { lastTitle = title; edit('',text); };
  io.clear = function (text) { commit=null;edit(text,''); };
  io.beforeCommit = function (p,title,text) {
    if (!lastTitle || !sameChat(lastTitle,title) || !exactDraft(observe(),title,text)) fail('提交前会话或完整草稿核对失败');
    commit={title:title,text:text};
  };
  io.click = function (p) {
    var before = observe(), buttons = before.items.filter(function (i) { return i.role==='send' && String(i.point)===String(p); });
    if (buttons.length!==1 || !commit || !exactDraft(before,commit.title,commit.text)) fail('发送控件、接收对象或草稿已变化');
    var candidates=last.nodes.filter(function(n){return valid(n)&&n.text==='发送'&&String(point(n))===String(p);});
    if(candidates.length!==1)fail('发送控件不唯一'); var b=candidates[0].bounds;
    commit=null;
    if(!click(Math.floor((b[0]+b[2])/2),Math.floor((b[1]+b[3])/2)))fail('发送结果不明，未重试');
  };
  io.nickname = function () { home(); clickId('ndw'); var nodes=tree(), header=one(nodes,'og3'), name=one(nodes,'mi0'); if(!under(nodes,name,header)||!name.text.trim())fail('未确认个人信息中的姓名');return name.text; };
  return io;
}
module.exports = { create: create, homeReady: homeReady, exactDraft: exactDraft };
