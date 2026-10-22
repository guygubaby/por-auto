// GENERATED from mobile-workflows/shared/src/io.js
'use strict';

var TimeUnit = java.util.concurrent.TimeUnit;
var AUTOJS = String(context.getPackageName());

function bytes(text) { return new java.lang.String(String(text)).getBytes('UTF-8'); }
function base64(data) { return String(android.util.Base64.encodeToString(data, android.util.Base64.NO_WRAP)); }
function decode(text) { return android.util.Base64.decode(String(text), android.util.Base64.NO_WRAP); }
function write(path, value) {
  var parent = new java.io.File(path).getParentFile();
  if (!parent.isDirectory() && !parent.mkdirs()) throw new Error('无法创建本地数据目录');
  var temporary = path + '.next-' + String(java.util.UUID.randomUUID());
  var out = new java.io.FileOutputStream(temporary);
  try { out.write(bytes(JSON.stringify(value, null, 2))); out.getFD().sync(); } finally { out.close(); }
  try { Packages.android.system.Os.rename(temporary, path); } finally { files.remove(temporary); }
}
function read(path, fallback) {
  if (!files.exists(path)) return fallback;
  try { return JSON.parse(files.read(path)); } catch (_) { throw new Error('本地文件无法读取，已保留原文件'); }
}

module.exports = function (por) {
  var directory = por.dataDir, secretFile = directory + '/credentials.json';
  // Existing WeCom credentials were encrypted under this historical alias.
  var alias = 'com.por.autojs6.wechat.credentials.v1';
  var store = java.security.KeyStore.getInstance('AndroidKeyStore');
  store.load(null);

  function cryptoKey() {
    if (!store.containsAlias(alias)) {
      var generator = javax.crypto.KeyGenerator.getInstance('AES', 'AndroidKeyStore');
      var properties = android.security.keystore.KeyProperties;
      generator.init(new android.security.keystore.KeyGenParameterSpec.Builder(
        alias,
        properties.PURPOSE_ENCRYPT | properties.PURPOSE_DECRYPT,
      ).setBlockModes(['GCM']).setEncryptionPaddings(['NoPadding']).build());
      generator.generateKey();
    }
    return store.getKey(alias, null);
  }

  function saveSecret(endpoint, value) {
    if (!value || value.length > 2000 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('鉴权值不能为空、过长或包含控制字符');
    var id = String(java.util.UUID.randomUUID()), cipher = javax.crypto.Cipher.getInstance('AES/GCM/NoPadding');
    cipher.init(javax.crypto.Cipher.ENCRYPT_MODE, cryptoKey());
    cipher.updateAAD(bytes(endpoint + '\n' + id));
    var encrypted = { endpoint: endpoint, iv: base64(cipher.getIV()), data: base64(cipher.doFinal(bytes(value))) };
    var all = read(secretFile, {});
    all[id] = encrypted;
    write(secretFile, all);
    return id;
  }

  function secret(id, endpoint) {
    var value = read(secretFile, {})[id];
    if (!value || value.endpoint !== endpoint) throw new Error('接口地址改变或凭据缺失，请重新填写鉴权值');
    try {
      var cipher = javax.crypto.Cipher.getInstance('AES/GCM/NoPadding');
      cipher.init(javax.crypto.Cipher.DECRYPT_MODE, cryptoKey(), new javax.crypto.spec.GCMParameterSpec(128, decode(value.iv)));
      cipher.updateAAD(bytes(endpoint + '\n' + id));
      return String(new java.lang.String(cipher.doFinal(decode(value.data)), 'UTF-8'));
    } catch (_) {
      throw new Error('手机凭据无法解密，请重新保存；不会导出密钥');
    }
  }

  function parseUrl(url) {
    try {
      var value = new Packages.okhttp3.Request.Builder().url(String(url)).build().url();
      return {
        scheme: String(value.scheme()),
        host: String(value.host()),
        username: String(value.username()),
        password: String(value.password()),
        fragment: value.fragment() === null ? '' : String(value.fragment()),
      };
    } catch (_) {
      return null;
    }
  }

  function evaluateResponse(source) {
    var value = null, error = null;
    var worker = threads.start(function () {
      var Context = Packages.org.mozilla.javascript.Context, cx = Context.enter();
      try {
        cx.setOptimizationLevel(-1);
        var result = cx.evaluateString(cx.initSafeStandardObjects(), source, 'http-response.js', 1, null);
        if (typeof result === 'string' || result instanceof java.lang.String) value = String(result);
      } catch (e) { error = String(e.message || e); }
      finally { Context.exit(); }
    });
    try {
      worker.join(1000);
      if (worker.isAlive()) throw new Error('JavaScript 执行超时（最多 1 秒）');
      if (error !== null) throw new Error(error);
      return value;
    } finally { worker.interrupt(); }
  }

  function request(spec) {
    var client = new Packages.okhttp3.OkHttpClient.Builder()
      .connectTimeout(10, TimeUnit.SECONDS)
      .readTimeout(spec.timeoutSeconds, TimeUnit.SECONDS)
      .callTimeout(spec.timeoutSeconds, TimeUnit.SECONDS)
      .followRedirects(false)
      .followSslRedirects(false)
      .retryOnConnectionFailure(false)
      .build();
    var response;
    try {
      var url = new Packages.okhttp3.Request.Builder().url(spec.url).build().url().newBuilder();
      (spec.query || []).forEach(function (pair) { url.addQueryParameter(pair.name, pair.value); });
      var builder = new Packages.okhttp3.Request.Builder().url(url.build());
      (spec.headers || []).forEach(function (pair) { builder.addHeader(pair.name, pair.value); });
      var jsonType = Packages.okhttp3.MediaType.parse('application/json; charset=utf-8');
      var body = spec.body === null || spec.body === undefined ? null : Packages.okhttp3.RequestBody.create(jsonType, JSON.stringify(spec.body));
      if (['POST', 'PUT', 'PATCH'].indexOf(spec.method) >= 0 && body === null) body = Packages.okhttp3.RequestBody.create(jsonType, '');
      builder.method(spec.method, body);
      response = client.newCall(builder.build()).execute();
      if (response.code() < 200 || response.code() >= 300) return { status: response.code(), body: '' };
      var source = response.body();
      if (source === null || source.contentLength() > 524288) throw new Error('HTTP 响应为空或过大');
      var stream = source.byteStream(), output = new java.io.ByteArrayOutputStream();
      var buffer = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 8192), count;
      try {
        while ((count = stream.read(buffer)) !== -1) {
          if (output.size() + count > 524288) throw new Error('HTTP 响应超过 512 KiB');
          output.write(buffer, 0, count);
        }
        return { status: response.code(), body: String(new java.lang.String(output.toByteArray(), 'UTF-8')) };
      } finally {
        stream.close();
        output.close();
      }
    } catch (_) {
      throw new Error('HTTP 连接失败或超时，未自动重试；请检查手机网络和接口地址');
    } finally {
      if (response) response.close();
      client.dispatcher().cancelAll();
      client.connectionPool().evictAll();
    }
  }

  function requireAccessibility() {
    var value = String(android.provider.Settings.Secure.getString(context.getContentResolver(), 'enabled_accessibility_services') || '');
    if (!auto.service || !value.split(':').some(function (item) { return item.indexOf(AUTOJS + '/') === 0; })) {
      throw new Error('AutoJs6 无障碍服务已关闭或断开，请在手机恢复后重新运行');
    }
  }

  function focusedPackage() {
    if (!auto.service) return '';
    var windows = auto.service.getWindows(), found = '';
    for (var i = 0; i < windows.size(); i++) {
      if (!windows.get(i).isFocused()) continue;
      if (windows.get(i).getType() === 2) {
        var keyboard = windows.get(i).getRoot();
        try {
          if (keyboard && String(keyboard.getPackageName()) === 'android') return '';
        } finally {
          if (keyboard) keyboard.recycle();
        }
        continue;
      }
      if (windows.get(i).getType() !== 1) return '';
      var root = windows.get(i).getRoot();
      if (!root) return '';
      try {
        var name = String(root.getPackageName() || '');
        if (found && found !== name) return '';
        found = name;
      } finally {
        root.recycle();
      }
    }
    return found;
  }

  function record(result) {
    if (typeof por.recordResult === 'function') por.recordResult(result);
    else write(directory + '/runs/' + por.runId + '/result.json', result);
  }

  return {
    focusedPackage: focusedPackage,
    requireAccessibility: requireAccessibility,
    saveSecret: saveSecret,
    secret: secret,
    parseUrl: parseUrl,
    request: request,
    evaluateResponse: evaluateResponse,
    base64: function (text) { return base64(bytes(text)); },
    now: Date.now,
    runId: por.runId,
    serial: por.serial,
    sleep: sleep,
    wake: function () { device.wakeUpIfNeeded(); },
    log: por.log,
    record: record,
  };
};
