import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';
import { createRenderer } from 'vue';

test('schedule controller rejects double submissions and ignores stale refreshes', async () => {
  const previous = Object.fromEntries(['window', 'isTauri'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  let response = { tasks: [], runningIds: [], error: null };
  let deferred;
  let holdList = false;
  let failSave = false;
  let writes = 0;
  let unlistens = 0;
  const calls = [];
  Object.defineProperties(globalThis, {
    isTauri: { configurable: true, value: true },
    window: { configurable: true, value: {
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
      __TAURI_INTERNALS__: {
        transformCallback: () => 1,
        async invoke(command, args) {
          calls.push({ command, args });
          if (command === 'plugin:event|listen') return 1;
          if (command === 'plugin:event|unlisten') { unlistens++; return; }
          if (command === 'list_schedules') {
            if (holdList) return new Promise(resolve => { deferred = resolve; });
            return structuredClone(response);
          }
          if (command === 'save_schedule') {
            writes++;
            await Promise.resolve();
            if (failSave) throw new Error('invalid cron');
            response = { tasks: [{ id: 'saved', name: args.input.name }], runningIds: [], error: null };
            return structuredClone(response);
          }
          if (command === 'run_schedule_now') {
            response = { ...response, runningIds: [args.id] };
            return structuredClone(response);
          }
          throw new Error(`Unexpected command: ${command}`);
        },
      },
    } },
  });
  const root = fileURLToPath(new URL('../', import.meta.url));
  const server = await createServer({ root, configFile: false, appType: 'custom', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false } });
  // A Vue host without a browser exercises mount/unmount and composable ownership.
  const renderer = createRenderer({
    createElement: tag => ({ tag }), createText: text => ({ text }), createComment: text => ({ text }),
    insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
    parentNode: () => null, nextSibling: () => null,
  });
  let app;
  try {
    const { useSchedules, formatScheduleTime, snapshotChanged } = await server.ssrLoadModule('/src/useSchedules.ts');
    const installed = { key: 'test', commit: 'bundled', workflow: { version: '1.0.0' } };
    assert.equal(snapshotChanged(installed, { ...installed, input: null, hooks: { beforeRun: null, afterRun: null } }), false);
    assert.equal(snapshotChanged({ ...installed, input: { message: { type: 'manual', text: 'Ok' } } }, installed), true);
    assert.equal(snapshotChanged({ ...installed, hooks: { beforeRun: { url: 'https://example.com' }, afterRun: null } }, installed), true);
    let controller;
    app = renderer.createApp({ setup() { controller = useSchedules(); return () => null; } });
    app.mount({});
    await new Promise(setImmediate);
    assert.equal(calls.some(call => call.command === 'list_schedules'), true);

    holdList = true;
    const oldRefresh = controller.refresh();
    const save = controller.change('save_schedule', { input: { name: 'daily' } });
    assert.equal(controller.busyRef.value, true);
    assert.equal(await controller.change('save_schedule', { input: { name: 'duplicate' } }), false);
    assert.equal(await save, true);
    assert.equal(writes, 1);
    deferred({ tasks: [], runningIds: [], error: null });
    await oldRefresh;
    assert.equal(controller.viewRef.value.tasks[0].name, 'daily');

    assert.equal(await controller.change('run_schedule_now', { id: 'saved' }), true);
    assert.deepEqual(controller.viewRef.value.runningIds, ['saved']);
    failSave = true;
    assert.equal(await controller.change('save_schedule', { input: { name: 'bad' } }), false);
    assert.match(controller.errorRef.value, /invalid cron/);
    assert.equal(controller.viewRef.value.tasks[0].name, 'daily');
    assert.equal(controller.busyRef.value, false);
    assert.match(formatScheduleTime(Date.parse('2026-10-15T01:00:00Z'), 'Asia/Shanghai'), /09:00:00/);
    assert.match(formatScheduleTime(Date.parse('2026-10-15T01:00:00Z'), 'Unknown/Timezone'), /01:00:00.000Z \(UTC\)/);
    app.unmount();
    app = null;
    await new Promise(setImmediate);
    assert.equal(unlistens, 1);
  } finally {
    app?.unmount();
    await server.close();
    for (const [name, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
