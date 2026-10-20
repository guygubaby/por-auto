'use strict';

var CERTIFICATE = '5ea6dc0f8484d80bea44e4e56463f9a95de97381b17c6b57f10a0e9d6505c627';
function create(call, id, packageName) {
  var owned = null, lastSession = null;
  function invoke(method, data) {
    data.protocolVersion = 1;
    var value = call(method, data);
    if (!value || value.ok !== true) { var error = new Error('原生输入未完成：' + (value && value.error || 'INVALID_RESPONSE') + '；未自动重试'); error.code = value && value.error || 'INVALID_RESPONSE'; throw error; }
    if (value.protocolVersion !== 1 || value.versionCode < 1) throw new Error('输入组件版本不兼容，请重新安装组件');
    return value;
  }
  function frame(value) {
    if (value.packageName !== packageName || typeof value.sessionId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.sessionId)
        || value.complete !== true || typeof value.text !== 'string' || typeof value.imeAction !== 'number') throw new Error('没有取得完整的目标输入框内容，未输入或清理');
    return value;
  }
  function read() { return frame(invoke('read', {packageName:packageName})); }
  function write(text) {
    var before = read();
    if (before.text !== '') throw new Error('输入框已有草稿，未覆盖');
    var after = frame(invoke('write', {packageName:packageName,sessionId:before.sessionId,requestId:id(),text:text}));
    if (after.sessionId !== before.sessionId || after.text !== text || typeof after.ownerId !== 'string' || !after.ownerId) throw new Error('原生输入结果不明，未自动重试；请核对手机草稿');
    owned = {sessionId:after.sessionId,ownerId:after.ownerId,text:text};lastSession = after.sessionId;
    return after;
  }
  function clear(text) {
    var before = read();
    if (!owned || owned.text !== text || owned.sessionId !== before.sessionId || before.text !== text) throw new Error('输入框或草稿内容已变化，未自动清理');
    var after = frame(invoke('clearOwned', {packageName:packageName,sessionId:owned.sessionId,requestId:id(),ownerId:owned.ownerId}));
    if (after.sessionId !== before.sessionId || after.text !== '') throw new Error('原生清理结果不明，未自动重试');
    owned = null;return after;
  }
  function observed() {
    if (!lastSession) return null;
    var current;
    try { current = read(); } catch (error) { if (['NO_EDITOR','PRIVATE_OR_UNSUPPORTED_EDITOR'].indexOf(error.code) >= 0) return null; throw error; }
    return current.sessionId === lastSession ? current : null;
  }
  return {read:read,write:write,clear:clear,observed:observed};
}
module.exports = {create:create,certificate:CERTIFICATE};
