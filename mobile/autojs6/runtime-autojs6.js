// Android-only adapter. The updater core has no Android or Node dependencies.
function createAutoJs6Runtime() {
  var File = java.io.File;
  var TimeUnit = java.util.concurrent.TimeUnit;
  var root = String(new File(context.getFilesDir(), 'por-auto-mobile').getCanonicalPath());
  var heldLocks = [];
  var client = new Packages.okhttp3.OkHttpClient.Builder()
    .connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS)
    .callTimeout(60, TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).build();
  var host = String(context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName);

  function file(path) {
    var value = new File(String(path)).getCanonicalFile();
    var canonical = String(value.getPath());
    if (canonical !== root && canonical.indexOf(root + '/') !== 0) throw new Error('拒绝访问脚本数据目录以外的文件');
    return value;
  }
  function mkdir(path) {
    var value = file(path);
    if (!value.isDirectory() && !value.mkdirs()) throw new Error('无法创建手机脚本目录');
  }
  function encode(text) { return new java.lang.String(String(text)).getBytes('UTF-8'); }
  function decode(bytes) { return String(new java.lang.String(bytes, 'UTF-8')); }
  function readStream(input, limit) {
    var output = new java.io.ByteArrayOutputStream();
    var buffer = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 8192);
    try {
      var count;
      while ((count = input.read(buffer)) !== -1) {
        if (output.size() + count > limit) throw new Error('文件超过大小限制');
        output.write(buffer, 0, count);
      }
      return output.toByteArray();
    } finally { input.close(); output.close(); }
  }
  function readBytes(path) {
    var value = file(path);
    if (!value.isFile() || value.length() > 16 * 1024 * 1024) throw new Error('文件不存在或超过读取限制：' + value.getName());
    return readStream(new java.io.FileInputStream(value), 16 * 1024 * 1024);
  }
  function writeBytes(path, bytes) {
    var value = file(path);
    mkdir(String(value.getParent()));
    var out = new java.io.FileOutputStream(value);
    try { out.write(bytes); out.getFD().sync(); } finally { out.close(); }
  }
  function writeAtomic(path, text) {
    var temporary = path + '.next-' + String(java.util.UUID.randomUUID());
    try { writeBytes(temporary, encode(text)); Packages.android.system.Os.rename(String(file(temporary).getPath()), String(file(path).getPath())); }
    finally { var leftover = file(temporary); if (leftover.exists()) leftover.delete(); }
  }
  function removeTree(path) {
    var value = file(path);
    if (!value.exists()) return;
    if (value.isDirectory()) {
      var children = value.listFiles();
      if (children === null) throw new Error('无法读取脚本目录');
      for (var i = 0; i < children.length; i++) removeTree(String(children[i].getPath()));
    }
    if (!value.delete()) throw new Error('无法清理临时脚本文件');
  }
  function release(lock) {
    if (lock.done) return;
    lock.done = true;
    try { if (lock.lease) lock.lease.release(); } finally { lock.handle.close(); }
    var index = heldLocks.indexOf(lock); if (index >= 0) heldLocks.splice(index, 1);
  }
  function withLock(path, action) {
    var handle = new java.io.RandomAccessFile(file(path), 'rw');
    var lease;
    try { lease = handle.getChannel().tryLock(); }
    catch (_) { handle.close(); throw new Error('另一启动器正在运行任务或更新，请等待完成'); }
    if (lease === null) { handle.close(); throw new Error('另一启动器正在运行任务或更新，请等待完成'); }
    var lock = { handle: handle, lease: lease, done: false };
    heldLocks.push(lock);
    try { return action(); } finally { release(lock); }
  }
  mkdir(root);
  events.on('exit', function () {
    var locks = heldLocks.slice();
    locks.forEach(function (lock) { try { release(lock); } catch (_) {} });
    client.dispatcher().cancelAll();
  });
  return {
    root: root, hostVersion: host, encode: encode, decode: decode,
    now: function () { return Date.now(); },
    uuid: function () { return String(java.util.UUID.randomUUID()); },
    mkdir: mkdir, writeAtomic: writeAtomic, writeBytes: writeBytes, readBytes: readBytes, removeTree: removeTree, withLock: withLock,
    exists: function (path) { return file(path).exists(); },
    readText: function (path) { return decode(readBytes(path)); },
    rename: function (from, to) { Packages.android.system.Os.rename(String(file(from).getPath()), String(file(to).getPath())); },
    append: function (path, text) {
      var out = new java.io.FileOutputStream(file(path), true);
      try { out.write(encode(text)); out.getFD().sync(); } finally { out.close(); }
    },
    list: function (path) {
      var values = file(path).list(); var result = [];
      if (values === null) return result;
      for (var i = 0; i < values.length; i++) result.push(String(values[i]));
      return result;
    },
    sha256: function (bytes) {
      var digest = java.security.MessageDigest.getInstance('SHA-256').digest(bytes); var result = '';
      for (var i = 0; i < digest.length; i++) result += ('0' + ((digest[i] + 256) % 256).toString(16)).slice(-2);
      return result;
    },
    base64: function (value) { return android.util.Base64.decode(value, android.util.Base64.NO_WRAP); },
    request: function (url, token, limit) {
      if (!/^https:\/\/api\.github\.com\/repos\//.test(url)) throw new Error('只允许从配置的 GitHub 仓库下载');
      var builder = new Packages.okhttp3.Request.Builder().url(url)
        .header('Accept', 'application/vnd.github.raw+json').header('X-GitHub-Api-Version', '2022-11-28')
        .header('User-Agent', 'PorAuto-AutoJs6/1');
      if (token) builder.header('Authorization', 'Bearer ' + token);
      var response;
      try {
        response = client.newCall(builder.build()).execute();
        var code = response.code();
        if (code !== 200) {
          if (code === 401) throw new Error('GitHub 令牌无效或过期');
          if (code === 403 || code === 429) throw new Error('GitHub 权限不足或访问次数受限，请检查权限或稍后重试');
          if (code === 404) throw new Error('仓库、分支或脚本文件不存在；私有仓库请先输入只读令牌');
          throw new Error('GitHub 请求失败，HTTP ' + code);
        }
        var body = response.body();
        if (body === null || body.contentLength() > limit) throw new Error('GitHub 文件为空或超过大小限制');
        return readStream(body.byteStream(), limit);
      } catch (error) {
        var message = String(error.message || error);
        if (token) message = message.split(token).join('[redacted]');
        throw new Error(message);
      } finally { if (response !== undefined && response !== null) response.close(); }
    },
    load: function (path) { return require(String(file(path).getPath())); },
    importFile: function (path) {
      // User-selected offline packages may live outside our private data directory.
      var value = new File(String(path));
      if (!value.isFile() || value.length() > 16 * 1024 * 1024) throw new Error('离线脚本包不存在或超过 16 MiB');
      return JSON.parse(decode(readStream(new java.io.FileInputStream(value), 16 * 1024 * 1024)));
    },
    exportFile: function (value) {
      var parent = context.getExternalFilesDir(null);
      if (parent === null) throw new Error('手机外部文件目录不可用');
      var destination = new File(parent, 'por-auto-exports');
      if (!destination.isDirectory() && !destination.mkdirs()) throw new Error('无法创建日志导出目录');
      var output = new File(destination, 'por-auto-mobile-debug-' + Date.now() + '.json');
      var out = new java.io.FileOutputStream(output);
      try { out.write(encode(JSON.stringify(value, null, 2))); out.getFD().sync(); } finally { out.close(); }
      return String(output.getPath());
    }
  };
}
