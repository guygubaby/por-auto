import { computed, ref, shallowRef, watch } from 'vue';
import { defineStore } from 'pinia';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import bundled from '../workflows/wechat-nickname/workflow.json';

export interface Device { serial: string; state: string; model: string }
interface Environment { ready: boolean; version: string; platform: string; devices: Device[] }
export interface Workflow { id: string; name: string; version: string; description: string; package: string; steps: { name: string }[] }
export interface Registry { url: string; reference: string; name: string; commit: string; workflows: Workflow[] }
export interface Installed { key: string; registryUrl: string; reference: string; commit: string; workflow: Workflow }
export interface Store { schemaVersion: number; registries: Registry[]; installed: Installed[] }
export interface RunResult { nickname: string | null; outputs: Record<string, string>; workflow_name: string; workflow_version: string; serial: string; timestamp: number; screenshot: string | null; error: string | null; warning: string | null; folder: string }
export interface DeviceRun { serial: string; model: string; status: 'queued' | 'running' | 'completed' | 'failed'; result: RunResult | null; error: string | null }
interface Progress { step: number; total: number; message: string }
export interface RegistryInput { url: string; reference: string; token: string }

export const DEFAULT_REGISTRY_URL = 'https://github.com/guygubaby/por-auto';
export function isOfficialRegistry(registry: Registry): boolean {
  return registry.url.toLowerCase() === DEFAULT_REGISTRY_URL && registry.reference === 'main';
}

export const useConnectionStore = defineStore('connection', () => {
  const desktop = isTauri();
  const environmentRef = shallowRef<Environment | null>(null);
  const selectedSerialsRef = shallowRef<string[]>([]);
  const busyRef = ref(false);
  const runningRef = ref(false);
  const errorRef = ref('');
  const noticeRef = ref('');
  const progressRef = shallowRef<Progress>({ step: 0, total: 0, message: '等待开始' });
  const deviceRunsRef = shallowRef<DeviceRun[]>([]);
  const resultRef = computed(() => deviceRunsRef.value.reduce<RunResult | null>((latest, run) => run.result ?? latest, null));
  const activeRunRef = computed(() => deviceRunsRef.value.find(run => run.status === 'running'));
  const batchSummaryRef = computed(() => {
    const succeeded = deviceRunsRef.value.filter(run => run.status === 'completed').length;
    const failed = deviceRunsRef.value.filter(run => run.status === 'failed').length;
    return { total: deviceRunsRef.value.length, succeeded, failed, done: succeeded + failed, current: deviceRunsRef.value.findIndex(run => run.status === 'running') + 1 };
  });
  const defaultUrl = DEFAULT_REGISTRY_URL;
  const storeRef = shallowRef<Store>({ schemaVersion: 1, registries: [{ url: defaultUrl, reference: 'main', name: 'Por Auto 官方工作流', commit: 'bundled', workflows: [bundled] }], installed: [{ key: 'preview', registryUrl: defaultUrl, reference: 'main', commit: 'bundled', workflow: bundled }] });
  const workflowKeyRef = ref('preview');
  const selectedWorkflowRef = computed(() => storeRef.value.installed.find(item => item.key === workflowKeyRef.value));
  const readyDevicesRef = computed(() => environmentRef.value?.devices.filter(device => device.state === 'device') ?? []);
  const selectedDevicesRef = computed(() => readyDevicesRef.value.filter(device => selectedSerialsRef.value.includes(device.serial)));
  let unlisten: UnlistenFn | undefined;
  let disposed = false;

  watch([selectedSerialsRef, workflowKeyRef], () => {
    if (desktop) localStorage.setItem('selection', JSON.stringify({ serials: selectedSerialsRef.value, workflow: workflowKeyRef.value }));
  });

  function applyEnvironment(value: Environment): void {
    environmentRef.value = value;
    selectedSerialsRef.value = selectedSerialsRef.value.filter(serial => value.devices.some(device => device.serial === serial && device.state === 'device'));
  }

  function applyStore(value: Store): void {
    storeRef.value = value;
    if (!value.installed.some(item => item.key === workflowKeyRef.value)) workflowKeyRef.value = value.installed[0]?.key ?? '';
  }

  async function syncRegistry(input: RegistryInput): Promise<boolean> {
    return operate(async () => {
      applyStore(await invoke<Store>('sync_registry', { ...input }));
      noticeRef.value = '仓库已同步，可以安装或更新工作流';
    });
  }

  async function removeRegistry(registry: Registry): Promise<boolean> {
    return operate(async () => {
      applyStore(await invoke<Store>('remove_registry', { url: registry.url, reference: registry.reference }));
      noticeRef.value = '已移除 Registry，已安装的工作流仍可离线运行';
    });
  }

  async function installWorkflow(registry: Registry, workflow: Workflow): Promise<void> {
    await operate(async () => {
      applyStore(await invoke<Store>('install_workflow', { url: registry.url, reference: registry.reference, id: workflow.id }));
      const item = storeRef.value.installed.find(item => item.registryUrl === registry.url && item.reference === registry.reference && item.workflow.id === workflow.id);
      if (item) workflowKeyRef.value = item.key;
      noticeRef.value = `已安装 ${workflow.name} ${workflow.version}，可以在「设备与运行」中选择运行`;
    });
  }

  async function operate(job: () => Promise<void>): Promise<boolean> {
    if (busyRef.value) return false;
    if (!desktop) { errorRef.value = '当前是界面预览。请打开安装后的桌面客户端执行此操作。'; return false; }
    busyRef.value = true;
    errorRef.value = '';
    noticeRef.value = '';
    try { await job(); return true; } catch (error) { errorRef.value = String(error); return false; }
    finally { busyRef.value = false; }
  }

  async function refresh(): Promise<void> {
    await operate(async () => {
      applyEnvironment(await invoke<Environment>('check_environment'));
    });
  }

  async function initialize(): Promise<void> {
    await operate(async () => {
      applyEnvironment(await invoke<Environment>('initialize_environment'));
      noticeRef.value = '连接组件已就绪，可以连接手机了';
    });
  }

  async function runWorkflow(): Promise<void> {
    const workflow = selectedWorkflowRef.value;
    const devices = [...selectedDevicesRef.value];
    if (!devices.length || !workflow) return;
    await operate(async () => {
      deviceRunsRef.value = devices.map(device => ({ serial: device.serial, model: device.model, status: 'queued', result: null, error: null }));
      runningRef.value = true;
      try {
        for (const [index, device] of devices.entries()) {
          updateDeviceRun(index, { status: 'running' });
          progressRef.value = { step: 1, total: workflow.workflow.steps.length, message: '正在连接手机' };
          try {
            const result = await invoke<RunResult>('run_workflow', { serial: device.serial, workflowKey: workflow.key });
            updateDeviceRun(index, { status: result.error ? 'failed' : 'completed', result, error: result.error });
          } catch (error) {
            updateDeviceRun(index, { status: 'failed', error: String(error) });
          }
        }
        const { total, succeeded, failed } = batchSummaryRef.value;
        const summary = `工作流「${workflow.workflow.name}」执行结束：${total} 台手机，成功 ${succeeded} 台，失败 ${failed} 台，请查看运行结果`;
        if (failed) errorRef.value = summary;
        else noticeRef.value = summary;
      } finally { runningRef.value = false; }
    });
  }

  function updateDeviceRun(index: number, patch: Partial<DeviceRun>): void {
    deviceRunsRef.value = deviceRunsRef.value.map((run, position) => position === index ? { ...run, ...patch } : run);
  }

  async function openResults(): Promise<void> {
    await operate(async () => { await invoke('open_results'); });
  }

  async function initializeApp(): Promise<void> {
    if (!desktop) return;
    try {
      try {
        const saved: { serials?: unknown; serial?: unknown; workflow?: unknown } | null = JSON.parse(localStorage.getItem('selection') ?? '{}');
        if (saved && typeof saved === 'object') {
          if (Array.isArray(saved.serials)) selectedSerialsRef.value = [...new Set(saved.serials.filter((serial): serial is string => typeof serial === 'string'))];
          else if (typeof saved.serial === 'string' && saved.serial) selectedSerialsRef.value = [saved.serial];
          workflowKeyRef.value = typeof saved.workflow === 'string' ? saved.workflow : '';
        }
      } catch { /* Use defaults if local selections are incomplete. */ }
      const stop = await listen<Progress>('workflow-progress', event => { progressRef.value = event.payload; });
      if (disposed) { stop(); return; }
      unlisten = stop;
      applyStore(await invoke<Store>('workflow_store'));
      await refresh();
    } catch (error) { errorRef.value = String(error); }
  }
  function dispose(): void { disposed = true; unlisten?.(); }

  return { desktop, environmentRef, selectedSerialsRef, busyRef, runningRef, errorRef, noticeRef, progressRef, resultRef, deviceRunsRef, activeRunRef, batchSummaryRef, readyDevicesRef, selectedDevicesRef, storeRef, workflowKeyRef, selectedWorkflowRef, syncRegistry, removeRegistry, installWorkflow, refresh, initialize, runWorkflow, openResults, initializeApp, dispose };
});
