import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

test('restores device selections and runs a frozen batch in parallel through failures', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const workflow = JSON.parse(await readFile(new URL('../workflows/wechat-nickname/workflow.json', import.meta.url), 'utf8'));
  const devices = ['A', 'B', 'C', 'D', 'E', 'F'].map(serial => ({ serial, model: `Phone ${serial}`, state: 'device' }));
  const environment = { ready: true, version: 'test', platform: 'macos', devices: [...devices, { serial: 'locked', model: 'Locked phone', state: 'unauthorized' }] };
  const local = new Map([['selection', JSON.stringify({ serial: 'A', workflow: 'installed' })]]);
  const calls = [];
  let concurrent = 0;
  let maxConcurrent = 0;
  let connection;
  let onProgress;
  const previous = Object.fromEntries(['window', 'localStorage', 'isTauri'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const invoke = async (command, args) => {
    if (command.startsWith('plugin:event|')) return 1;
    if (command === 'workflow_store') return { schemaVersion: 1, registries: [], installed: [{ key: 'installed', workflow }] };
    if (command === 'check_environment') return structuredClone(environment);
    if (command === 'initialize_environment') {
      environment.ready = true;
      environment.devices = [...devices];
      return structuredClone(environment);
    }
    if (command !== 'run_workflow') throw new Error(`Unexpected command: ${command}`);
    calls.push({ ...args });
    onProgress({ payload: { serial: args.serial, workflow_key: args.workflowKey, scheduled: true, step: 1, total: 6, message: 'Scheduled task must not overwrite manual progress' } });
    assert.equal(connection.deviceRunsRef.find(run => run.serial === args.serial).progress, undefined);
    onProgress({ payload: { serial: args.serial, workflow_key: args.workflowKey, scheduled: false, step: 1, total: 6, message: `Running ${args.serial}` } });
    assert.equal(connection.deviceRunsRef.find(run => run.serial === args.serial).progress.message, `Running ${args.serial}`);
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    try {
      await Promise.resolve();
      if (args.serial === 'A') {
        // The active batch must survive later changes to the current selection.
        connection.selectedSerialsRef = ['D'];
        connection.workflowKeyRef = 'changed-after-start';
      }
      if (args.serial === 'B') throw new Error('USB disconnected');
      return { serial: args.serial, nickname: args.serial, workflow_name: workflow.name, workflow_version: workflow.version, timestamp: calls.length, outputs: {}, screenshot: null, warning: null, error: args.serial === 'C' ? 'Target not found' : null, folder: `/test/${args.serial}` };
    } finally {
      concurrent--;
    }
  };
  Object.defineProperties(globalThis, {
    isTauri: { configurable: true, value: true },
    localStorage: { configurable: true, value: { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value) } },
    window: { configurable: true, value: { __TAURI_INTERNALS__: { invoke, transformCallback: callback => { onProgress = callback; return 1; } }, __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} } } },
  });
  const server = await createServer({ root, configFile: false, appType: 'custom', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false } });
  try {
    const { useConnectionStore } = await server.ssrLoadModule('/src/useConnection.ts');
    setActivePinia(createPinia());
    connection = useConnectionStore();
    await connection.initializeApp();
    await nextTick();
    assert.deepEqual(connection.selectedSerialsRef, ['A']);
    assert.deepEqual(JSON.parse(local.get('selection')).serials, ['A']);

    environment.ready = false;
    environment.devices = [];
    await connection.refresh();
    assert.equal(connection.environmentRef.ready, false);
    assert.match(connection.errorRef, /请先点击「初始化连接组件」/);
    assert.equal(connection.busyRef, false);
    await connection.initialize();
    assert.equal(connection.environmentRef.ready, true);
    assert.equal(connection.errorRef, '');
    await connection.refresh();
    assert.equal(connection.errorRef, '');

    connection.selectedSerialsRef = [];
    await connection.refresh();
    assert.deepEqual(connection.selectedSerialsRef, []);
    await connection.runWorkflow();
    assert.equal(calls.length, 0);

    connection.selectedSerialsRef = ['A', 'locked', 'missing', 'B', 'C', 'D', 'E', 'F'];
    await connection.refresh();
    assert.deepEqual(connection.selectedSerialsRef, ['A', 'B', 'C', 'D', 'E', 'F']);
    const batch = connection.runWorkflow();
    assert.equal(connection.busyRef, true);
    assert.equal(connection.runningRef, true);
    await Promise.all([batch, connection.runWorkflow()]);
    assert.deepEqual(calls.map(call => call.serial), ['A', 'B', 'C', 'D', 'E', 'F']);
    assert.ok(calls.every(call => call.workflowKey === 'installed'));
    assert.equal(maxConcurrent, 4);
    assert.deepEqual(connection.deviceRunsRef.map(run => run.status), ['completed', 'failed', 'failed', 'completed', 'completed', 'completed']);
    assert.match(connection.deviceRunsRef[1].error, /USB disconnected/);
    assert.equal(connection.deviceRunsRef[2].error, 'Target not found');
    assert.equal(connection.deviceRunsRef[0].result.serial, 'A');
    assert.equal(connection.deviceRunsRef[3].result.serial, 'D');
    assert.equal(connection.resultRef.serial, 'F');
    assert.equal(connection.batchSummaryRef.done, 6);
    assert.equal(connection.batchSummaryRef.failed, 2);
    assert.equal(connection.busyRef, false);
    assert.equal(connection.runningRef, false);
  } finally {
    connection?.dispose();
    await server.close();
    for (const [name, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
