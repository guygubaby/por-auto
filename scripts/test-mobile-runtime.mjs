import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

test('native task session keeps the phone active without requesting or releasing screen capture', () => {
  const value = runtimeFixture();
  value.io.screenSession.acquire(false);
  assert.equal(value.io.screenSession.isActive(), true);
  assert.equal(value.io.screenSession.hasCapture(), false);
  value.io.screenSession.check(); value.io.screenSession.release();
  assert.equal(value.calls.capture, 0); assert.equal(value.calls.stopCapture, 0);
  assert.equal(value.calls.keepAwake, 1); assert.equal(value.calls.releaseAwake, 1);
  assert.equal(value.calls.startForeground, 1); assert.equal(value.calls.stopForeground, 1);
});

function runtimeFixture({ foregroundActive = false, captureAllowed = true, locked = false, failWake = false } = {}) {
  const events = [], calls = { capture: 0, stopCapture: 0, startForeground: 0, stopForeground: 0, keepAwake: 0, releaseAwake: 0 };
  class File {
    constructor(parent, child) { this.path = child ? String(parent) + '/' + child : String(parent); }
    toString() { return this.path; } getCanonicalPath() { return this.path; } getCanonicalFile() { return this; } getPath() { return this.path; }
    isDirectory() { return true; } exists() { return true; }
  }
  class AtomicBoolean { constructor(value) { this.value = value; } get() { return this.value; } set(value) { this.value = value; } }
  const client = { dispatcher: () => ({ cancelAll() {} }), connectionPool: () => ({ evictAll() {} }) };
  class Builder { connectTimeout() { return this; } readTimeout() { return this; } callTimeout() { return this; } followRedirects() { return this; } followSslRedirects() { return this; } build() { return client; } }
  const sandbox = {
    java: { io: { File }, util: { concurrent: { TimeUnit: { SECONDS: 'seconds' }, atomic: { AtomicBoolean } } } },
    Packages: { okhttp3: { OkHttpClient: { Builder } } },
    android: { content: { Context: { KEYGUARD_SERVICE: 'keyguard', ACTIVITY_SERVICE: 'activity' }, Intent: class { setClassName() { return this; } } }, os: { Build: { VERSION: { SDK_INT: 28 } } } },
    context: {
      getFilesDir: () => '/private', getPackageName: () => 'org.autojs.autojs6',
      getPackageManager: () => ({ getPackageInfo: () => ({ versionName: '6.7.0' }) }),
      getSystemService: name => name === 'keyguard' ? { isKeyguardLocked: () => locked } : { getRunningServices: () => ({ size: () => foregroundActive ? 1 : 0, get: () => ({ service: { getClassName: () => 'org.autojs.autojs.external.foreground.AppForegroundService' } }) }) },
      startForegroundService() { calls.startForeground++; return {}; }, stopService() { calls.stopForeground++; }
    },
    events: { on: (name, callback) => { assert.equal(name, 'exit'); events.push(callback); } }, auto: { service: {} },
    currentPackage: () => 'org.autojs.autojs6', requestScreenCapture: () => { calls.capture++; return captureAllowed; },
    images: { stopScreenCapture() { calls.stopCapture++; } },
    device: { keepScreenDim() { calls.keepAwake++; if (failWake) throw Error('wake failed'); }, cancelKeepingAwake() { calls.releaseAwake++; } }
  };
  vm.createContext(sandbox);
  const io = vm.runInContext(readFileSync(new URL('../mobile/autojs6/runtime-autojs6.js', import.meta.url), 'utf8') + '\ncreateAutoJs6Runtime();', sandbox);
  return { io, calls, setLocked(value) { locked = value; }, exit() { events.forEach(callback => callback()); } };
}

test('mobile timer projection is granted once per engine session and cleanup respects service ownership', () => {
  for (const foregroundActive of [false, true]) {
    const { io, calls, exit } = runtimeFixture({ foregroundActive });
    assert.equal(io.screenSession.isActive(), false);
    io.screenSession.acquire(); io.screenSession.acquire();
    assert.equal(calls.capture, 1); assert.equal(calls.keepAwake, 1); assert.equal(io.screenSession.isActive(), true);
    io.screenSession.release(); io.screenSession.release(); exit();
    assert.equal(calls.stopCapture, 1); assert.equal(calls.releaseAwake, 1);
    assert.equal(calls.startForeground, foregroundActive ? 0 : 1); assert.equal(calls.stopForeground, foregroundActive ? 0 : 1);
  }
});

test('denied capture, locked device, wake failure and engine exit release only resources they acquired', () => {
  let value = runtimeFixture({ captureAllowed: false });
  assert.throws(() => value.io.screenSession.acquire(), /授权/); assert.equal(value.io.screenSession.isActive(), false);
  assert.equal(value.calls.stopForeground, 1); assert.equal(value.calls.keepAwake, 0); assert.equal(value.calls.stopCapture, 0);
  value = runtimeFixture({ locked: true });
  assert.throws(() => value.io.screenSession.acquire(), /解锁/); assert.equal(value.calls.capture, 0); assert.equal(value.calls.startForeground, 0);
  value = runtimeFixture({ failWake: true });
  assert.throws(() => value.io.screenSession.acquire(), /wake failed/); assert.equal(value.io.screenSession.isActive(), false);
  assert.equal(value.calls.stopCapture, 1); assert.equal(value.calls.releaseAwake, 1); assert.equal(value.calls.stopForeground, 1);
  value = runtimeFixture(); value.io.screenSession.acquire(); value.exit();
  assert.equal(value.io.screenSession.isActive(), false); assert.equal(value.calls.stopCapture, 1); assert.equal(value.calls.releaseAwake, 1);
  value = runtimeFixture(); value.io.screenSession.acquire(); value.setLocked(true);
  assert.throws(() => value.io.screenSession.check(), /已锁屏/); value.io.screenSession.release();
  assert.equal(value.calls.stopCapture, 1); assert.equal(value.calls.releaseAwake, 1);
});
