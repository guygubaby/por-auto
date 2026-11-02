'use strict';

function fail(message) { throw new Error(message); }
function object(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function text(value) {
  if (typeof value !== 'string' || !value.trim() || unescape(encodeURIComponent(value)).length > 4000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) fail('接口提取的消息必须是非空文字，最多 4000 字节');
  return value;
}
function expand(value, context) {
  if (typeof value === 'string') {
    var expanded = value.replace(/\{\{([^{}]*)\}\}/g, function (_, name) {
    name = name.trim();
    if (!/^[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*$/.test(name)) fail('请求变量名称无效');
    var result = context;
    name.split('.').forEach(function (part) { if (!object(result) || !Object.prototype.hasOwnProperty.call(result, part)) fail('当前时机没有变量：' + name); result = result[part]; });
    return typeof result === 'string' ? result : JSON.stringify(result);
    });
    if (expanded.indexOf('{{') >= 0 || expanded.indexOf('}}') >= 0) fail('请求变量括号不完整');
    return expanded;
  }
  if (Array.isArray(value)) return value.map(function (v) { return expand(v, context); });
  if (object(value)) { var result = {}; Object.keys(value).forEach(function (k) { Object.defineProperty(result, k, { value: expand(value[k], context), enumerable: true, writable: true, configurable: true }); }); return result; }
  return value;
}
function pointer(value, path) {
  if (typeof path !== 'string' || path.length > 1000 || path !== '' && path.charAt(0) !== '/' || /~(?![01])/.test(path)) fail('提取字段应使用 /data/message 这样的路径');
  if (path === '') return value;
  path.slice(1).split('/').forEach(function (part) {
    part = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, part)) fail('响应中找不到配置的消息字段');
    value = value[part];
  });
  return value;
}
function responseCode(response) {
  if (response.type === 'javascript') return response.code;
  if (response.type === 'json') return 'return res' + (response.pointer === '' ? [] : response.pointer.slice(1).split('/')).map(function (part) { return '[' + JSON.stringify(part.replace(/~1/g, '/').replace(/~0/g, '~')) + ']'; }).join('') + ';';
  return "return (res || []).map((item) => item.text).join('\\n');";
}
function validateResponse(response) {
  if (!object(response) || ['text', 'json', 'javascript', 'ignore'].indexOf(response.type) < 0) fail('响应解析方式无效');
  if (response.type === 'json' && (typeof response.pointer !== 'string' || response.pointer.length > 1000 || response.pointer !== '' && response.pointer.charAt(0) !== '/' || /~(?![01])/.test(response.pointer))) fail('JSON 字段路径无效');
  if (response.type === 'javascript') {
    if (typeof response.code !== 'string' || !response.code.trim() || response.code.length > 10000) fail('JavaScript 代码不能为空，最多 10000 字符');
    try { Function('res', '"use strict";\n' + response.code + '\n'); } catch (_) { fail('JavaScript 代码语法错误'); }
  }
}
function parse(raw, response, io) {
  validateResponse(response);
  if (response.type === 'ignore') return null;
  if (response.type === 'text') return text(raw);
  if (response.type === 'json') {
    var parsed; try { parsed = JSON.parse(raw); } catch (_) { fail('接口没有返回有效 JSON'); }
    return text(pointer(parsed, response.pointer));
  }
  var literal = JSON.stringify(raw).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  var source = '(function () { var res = ' + literal + '; try { res = JSON.parse(res); } catch (_) {} return (function (res) { "use strict";\n' + response.code + '\n})(res); })()';
  try { return text(io.evaluateResponse(source)); }
  catch (error) { fail('JavaScript 处理失败：' + String(error && error.message || error)); }
}
function validate(spec, io) {
  if (!object(spec) || typeof spec.url !== 'string' || spec.url.length > 2000 || !spec.auth || !spec.response) fail('HTTP 配置不完整');
  var url = io.parseUrl(spec.url);
  if (!url || !(url.scheme === 'https' || url.scheme === 'http' && ['localhost', '127.0.0.1', '::1', '[::1]'].indexOf(url.host) >= 0) || url.username || url.password || url.fragment) fail('HTTP 地址需要 HTTPS；手机本机服务可使用 HTTP。地址不能包含凭据');
  if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].indexOf(spec.method) < 0 || typeof spec.timeoutSeconds !== 'number' || spec.timeoutSeconds % 1 || spec.timeoutSeconds < 5 || spec.timeoutSeconds > 120) fail('HTTP 方法或超时配置无效');
  ['query', 'headers'].forEach(function (field) {
    if (!Array.isArray(spec[field]) || spec[field].length > 30) fail('查询参数或请求头不能超过 30 个');
    spec[field].forEach(function (p) { if (!object(p) || typeof p.name !== 'string' || !p.name || p.name.length > 200 || typeof p.value !== 'string' || p.value.length > 4000 || /[\x00-\x1f\x7f]/.test(p.name)) fail('请求参数格式无效'); });
  });
  spec.headers.forEach(function (h) { if (!/^[!#$%&'*+.^_\x60|~a-zA-Z0-9-]+$/.test(h.name) || /[\r\n]/.test(h.value) || /^(?:authorization|proxy-authorization|cookie)$/i.test(h.name)) fail('请求头格式无效；鉴权请通过鉴权选项配置'); });
  if (['none', 'bearer', 'basic', 'api_key'].indexOf(spec.auth.type) < 0 || spec.auth.type !== 'none' && !/^[a-f0-9-]{36}$/.test(spec.auth.credential || '')) fail('请先保存 HTTP 鉴权值');
  if (spec.auth.type === 'basic' && (typeof spec.auth.username !== 'string' || /[:\r\n]/.test(spec.auth.username))) fail('用户名无效');
  if (spec.auth.type === 'api_key' && (['header', 'query'].indexOf(spec.auth.location) < 0 || typeof spec.auth.name !== 'string' || !/^[a-zA-Z0-9_.-]{1,100}$/.test(spec.auth.name))) fail('API Key 名称或位置无效');
  validateResponse(spec.response);
  if (spec.body !== null && spec.body !== undefined && ['GET', 'DELETE'].indexOf(spec.method) >= 0) fail('GET 和 DELETE 不发送请求正文');
  if (spec.body !== null && spec.body !== undefined && JSON.stringify(spec.body).length > 65536) fail('请求正文过大');
  return spec;
}
function execute(spec, context, io, preview) {
  validate(spec, io);
  var query = expand(spec.query, context), headers = expand(spec.headers, context), body = expand(spec.body, context);
  headers.forEach(function (h) { if (/[\r\n]/.test(h.value)) fail('展开后的请求头包含换行，未请求'); });
  var auth = spec.auth;
  if (auth.type !== 'none') {
    var secret = io.secret(auth.credential, spec.url);
    if (typeof secret !== 'string' || !secret || /[\r\n]/.test(secret)) fail('鉴权值不可用，请重新保存');
    if (auth.type === 'bearer') headers.push({ name: 'Authorization', value: 'Bearer ' + secret });
    else if (auth.type === 'basic') headers.push({ name: 'Authorization', value: 'Basic ' + io.base64(auth.username + ':' + secret) });
    else (auth.location === 'header' ? headers : query).push({ name: auth.name, value: secret });
  }
  var started = io.now(), response = io.request({ url: spec.url, method: spec.method, query: query, headers: headers, body: body, timeoutSeconds: spec.timeoutSeconds });
  if (!response || typeof response.status !== 'number' || typeof response.body !== 'string' || response.body.length > 524288) fail('HTTP 响应格式无效或超过大小限制');
  var httpError = response.status < 200 || response.status >= 300 ? 'HTTP ' + response.status + '，未自动重试' : null;
  if (httpError && !preview) fail(httpError);
  var result = null, parseError = null;
  try {
    if (httpError) parseError = httpError;
    else result = parse(response.body, spec.response, io);
  } catch (error) {
    if (!preview) throw error;
    parseError = String(error.message || error);
  }
  var value = { status: response.status, elapsedMs: io.now() - started, fetchedAt: io.now(), message: result };
  if (preview) { value.raw = response.body; value.parseError = parseError; }
  return value;
}
module.exports = {
  fetch: function (spec, context, io) { return execute(spec, context, io, false); },
  preview: function (spec, context, io) { return execute(spec, context, io, true); },
  validate: validate, parse: parse, responseCode: responseCode, pointer: pointer, expand: expand
};
