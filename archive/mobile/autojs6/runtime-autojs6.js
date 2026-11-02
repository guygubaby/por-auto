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
    catch (_) { handle.close(); var conflict = new Error('另一启动器正在运行任务或更新，请等待完成'); conflict.code = 'BUSY'; throw conflict; }
    if (lease === null) { handle.close(); var busy = new Error('另一启动器正在运行任务或更新，请等待完成'); busy.code = 'BUSY'; throw busy; }
    var lock = { handle: handle, lease: lease, done: false };
    heldLocks.push(lock);
    try { return action(); } finally { release(lock); }
  }
  var zones = Object.create(null);
  function zone(name) {
    if (android.os.Build.VERSION.SDK_INT < 26) throw new Error('手机定时执行需要 Android 8 或更新版本');
    if (typeof name === 'string' && zones[name]) return zones[name];
    if (typeof name !== 'string' || name.length > 100 || !java.time.ZoneId.getAvailableZoneIds().contains(name)) throw new Error('请填写 Asia/Shanghai 等 IANA 时区');
    zones[name] = java.time.ZoneId.of(name); return zones[name];
  }
  var screenActive = new java.util.concurrent.atomic.AtomicBoolean(false), sessionForeground = false, sessionCapture = false;
  function requireAccessibility() {
    var value = String(android.provider.Settings.Secure.getString(context.getContentResolver(), 'enabled_accessibility_services') || '');
    var prefix = String(context.getPackageName()) + '/';
    if (!auto.service || !value.split(':').some(function (item) { return item.indexOf(prefix) === 0; })) throw new Error('AutoJs6 无障碍服务已关闭或断开，请在手机恢复后重新运行');
  }
  function focusedPackage() {
    requireAccessibility();
    var windows = auto.service.getWindows(), found = '';
    for (var n = 0; n < windows.size(); n++) {
      var window = windows.get(n); if (!window.isFocused()) continue;
      if (window.getType() === 2) {var keyboard=window.getRoot();try{if(keyboard&&String(keyboard.getPackageName())==='android')return '';}finally{if(keyboard)keyboard.recycle();}continue;}
      if (window.getType() !== 1) return '';
      var root = window.getRoot(); if (!root) return '';
      try {
        var name = String(root.getPackageName() || '');
        if (found && found !== name) return '';
        found = name;
      } finally { root.recycle(); }
    }
    return found;
  }
  var foregroundIntent = new android.content.Intent().setClassName(String(context.getPackageName()), 'org.autojs.autojs.external.foreground.AppForegroundService');
  function releaseScreenSession() {
    if (!screenActive.get()) return;
    screenActive.set(false);
    try { if (sessionCapture) { sessionCapture = false; images.stopScreenCapture(); } }
    finally { try { device.cancelKeepingAwake(); } finally { if (sessionForeground) { sessionForeground = false; context.stopService(foregroundIntent); } } }
  }
  var screenSession = {
    focusedPackage: focusedPackage,
    isActive: function () { return !!screenActive.get(); },
    hasCapture: function () { return !!sessionCapture; },
    check: function () {
      if (!screenActive.get()) throw new Error('执行会话已停止，请重新开启手机定时执行');
      requireAccessibility();
      if (context.getSystemService(android.content.Context.KEYGUARD_SERVICE).isKeyguardLocked()) throw new Error('手机已锁屏，请解锁后重新开启手机定时执行');
    },
    acquire: function (capture) {
      if (screenActive.get()) return;
      requireAccessibility();
      if (context.getSystemService(android.content.Context.KEYGUARD_SERVICE).isKeyguardLocked()) throw new Error('请先手动解锁手机');
      if (focusedPackage() !== String(context.getPackageName())) throw new Error('请在 AutoJs6 前台开启手机定时执行');
      var services = context.getSystemService(android.content.Context.ACTIVITY_SERVICE).getRunningServices(1000), active = false;
      for (var n = 0; n < services.size(); n++) if (String(services.get(n).service.getClassName()) === 'org.autojs.autojs.external.foreground.AppForegroundService') active = true;
      if (!active) {
        var started = android.os.Build.VERSION.SDK_INT >= 26 ? context.startForegroundService(foregroundIntent) : context.startService(foregroundIntent);
        if (!started) throw new Error('无法开启 AutoJs6 前台运行服务');
        sessionForeground = true;
      }
      try {
        if (capture !== false) {
          if (!requestScreenCapture()) throw new Error('没有获得本次屏幕读取授权');
          sessionCapture = true;
        }
        screenActive.set(true); device.keepScreenDim();
      } catch (e) { if (screenActive.get()) releaseScreenSession(); else if (sessionForeground) { sessionForeground = false; context.stopService(foregroundIntent); } throw e; }
    },
    release: releaseScreenSession
  };
  mkdir(root);
  events.on('exit', function () {
    try { releaseScreenSession(); } catch (_) {}
    var locks = heldLocks.slice();
    locks.forEach(function (lock) { try { release(lock); } catch (_) {} });
    client.dispatcher().cancelAll();
  });
  return {
    root: root, hostVersion: host, encode: encode, decode: decode,
    now: function () { return Date.now(); },
    screenSession: screenSession,
    localTimezone: function () { return String(java.util.TimeZone.getDefault().getID()); },
    validateZone: zone,
    formatTime: function (epoch, timezone) { return String(java.time.Instant.ofEpochMilli(epoch).atZone(zone(timezone)).format(java.time.format.DateTimeFormatter.ofPattern('yyyy-MM-dd HH:mm z'))); },
    cronInstant: function (name, year, month, day, hour, minute) {
      var rules = zone(name).getRules(), local = java.time.LocalDateTime.of(year, month, day, hour, minute), offsets = rules.getValidOffsets(local);
      return offsets.isEmpty() ? null : Number(local.toInstant(offsets.get(0)).toEpochMilli());
    },
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
