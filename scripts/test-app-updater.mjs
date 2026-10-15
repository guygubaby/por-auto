import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';
import { createRenderer } from 'vue';

test('update state follows native events, blocks double installation and preserves current status after a stale reply', async () => {
  const previous = Object.fromEntries(['window', 'isTauri'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const callbacks = new Map();
  let callbackId = 0;
  let eventId;
  let finishInstall;
  let installCalls = 0;
  let native = { currentVersion: '0.1.1', version: null, notes: null, phase: 'idle', autoCheck: true, checkedAt: null, downloaded: 0, total: null, error: null };
  function emit(patch) {
    native = { ...native, ...patch };
    callbacks.get(eventId)?.({ event: 'app-update-status', id: 1, payload: structuredClone(native) });
  }
  Object.defineProperties(globalThis, {
    isTauri: { configurable: true, value: true },
    window: { configurable: true, value: {
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
      __TAURI_INTERNALS__: {
        transformCallback(callback) { const id = ++callbackId; callbacks.set(id, callback); return id; },
        async invoke(command, args) {
          if (command === 'plugin:event|listen') { eventId = args.handler; return 1; }
          if (command === 'plugin:event|unlisten') return;
          if (command === 'update_status') return structuredClone(native);
          if (command === 'check_for_updates') {
            const stale = structuredClone(native);
            emit({ phase: 'checking' });
            emit({ phase: 'available', version: '0.1.2', notes: 'new release' });
            return stale;
          }
          if (command === 'set_auto_update_check') { emit({ autoCheck: args.enabled }); return structuredClone(native); }
          if (command === 'install_app_update') {
            installCalls++;
            emit({ phase: 'downloading', downloaded: 20, total: 100 });
            return new Promise(resolve => { finishInstall = resolve; });
          }
          throw new Error(`Unexpected command ${command}`);
        },
      },
    } },
  });
  const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, appType: 'custom', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false } });
  const renderer = createRenderer({
    createElement: tag => ({ tag }), createText: text => ({ text }), createComment: text => ({ text }),
    insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null,
  });
  let app;
  try {
    const { useAppUpdater } = await server.ssrLoadModule('/src/useAppUpdater.ts');
    let updater;
    app = renderer.createApp({ setup() { updater = useAppUpdater(); return () => null; } });
    app.mount({});
    await new Promise(setImmediate);
    await updater.action('check_for_updates');
    assert.equal(updater.statusRef.value.phase, 'available');
    assert.equal(updater.statusRef.value.version, '0.1.2');
    await updater.action('set_auto_update_check', { enabled: false });
    assert.equal(updater.statusRef.value.autoCheck, false);
    const installation = updater.action('install_app_update');
    await updater.action('install_app_update');
    assert.equal(installCalls, 1);
    assert.equal(updater.percentRef.value, 20);
    assert.equal(updater.installingRef.value, true);
    emit({ phase: 'error', error: 'signature invalid' });
    finishInstall(null);
    await installation;
    assert.equal(updater.statusRef.value.phase, 'error');
    assert.equal(updater.statusRef.value.error, 'signature invalid');
    assert.equal(updater.busyRef.value, false);
    app.unmount();
    app = null;
    emit({ phase: 'up-to-date' });
    assert.equal(updater.statusRef.value.phase, 'error');
  } finally {
    app?.unmount();
    await server.close();
    for (const [name, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
