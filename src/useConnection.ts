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
interface Progress { step: number; total: number; message: string }
export interface RegistryInput { url: string; reference: string; token: string }

export const useConnectionStore = defineStore('connection', () => {
  const desktop = isTauri();
  const environmentRef = shallowRef<Environment | null>(null);
  const selectedRef = ref('');
  const busyRef = ref(false);
  const runningRef = ref(false);
  const errorRef = ref('');
  const noticeRef = ref('');
  const progressRef = shallowRef<Progress>({ step: 0, total: 0, message: '等待开始' });
  const resultRef = shallowRef<RunResult | null>(null);
  const defaultUrl = 'https://github.com/guygubaby/por-auto';
  const storeRef = shallowRef<Store>({ schemaVersion: 1, registries: [{ url: defaultUrl, reference: 'main', name: 'Por Auto 官方工作流', commit: 'bundled', workflows: [bundled] }], installed: [{ key: 'preview', registryUrl: defaultUrl, reference: 'main', commit: 'bundled', workflow: bundled }] });
  const workflowKeyRef = ref('preview');
  const selectedWorkflowRef = computed(() => storeRef.value.installed.find(item => item.key === workflowKeyRef.value));
  const readyDevicesRef = computed(() => environmentRef.value?.devices.filter(device => device.state === 'device') ?? []);
  const selectedDeviceRef = computed(() => readyDevicesRef.value.find(device => device.serial === selectedRef.value));
  let unlisten: UnlistenFn | undefined;
  let disposed = false;

  watch([selectedRef, workflowKeyRef], () => {
    if (desktop) localStorage.setItem('selection', JSON.stringify({ serial: selectedRef.value, workflow: workflowKeyRef.value }));
  });

  function applyEnvironment(value: Environment): void {
    environmentRef.value = value;
    if (!value.devices.some(device => device.serial === selectedRef.value && device.state === 'device')) {
      selectedRef.value = value.devices.find(device => device.state === 'device')?.serial ?? '';
    }
  }

  function applyStore(value: Store): void {
    storeRef.value = value;
    if (!value.installed.some(item => item.key === workflowKeyRef.value)) workflowKeyRef.value = value.installed[0]?.key ?? '';
  }

  async function syncRegistry(input: RegistryInput): Promise<void> {
    await operate(async () => {
      applyStore(await invoke<Store>('sync_registry', { ...input }));
      noticeRef.value = '仓库已同步，可以安装或更新工作流';
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

  async function operate(job: () => Promise<void>): Promise<void> {
    if (busyRef.value) return;
    if (!desktop) { errorRef.value = '当前是界面预览。请打开安装后的桌面客户端连接手机。'; return; }
    busyRef.value = true;
    errorRef.value = '';
    noticeRef.value = '';
    try { await job(); } catch (error) { errorRef.value = String(error); }
    finally { busyRef.value = false; }
  }

  async function refresh(): Promise<void> {
    await operate(async () => {
      applyEnvironment(await invoke<Environment>('check_environment'));
      noticeRef.value = environmentRef.value?.devices.length ? '设备状态已刷新' : '暂未发现手机，请连接数据线并在手机上允许 USB 调试';
    });
  }

  async function initialize(): Promise<void> {
    await operate(async () => {
      applyEnvironment(await invoke<Environment>('initialize_environment'));
      noticeRef.value = '连接组件已就绪，可以连接手机了';
    });
  }

  async function runWorkflow(): Promise<void> {
    if (!selectedDeviceRef.value || !selectedWorkflowRef.value) return;
    await operate(async () => {
      resultRef.value = null;
      runningRef.value = true;
      progressRef.value = { step: 1, total: selectedWorkflowRef.value!.workflow.steps.length, message: '正在连接手机' };
      try {
        resultRef.value = await invoke<RunResult>('run_workflow', { serial: selectedRef.value, workflowKey: workflowKeyRef.value });
        if (resultRef.value.error) errorRef.value = resultRef.value.error;
        else noticeRef.value = `工作流「${resultRef.value.workflow_name}」执行完成，请查看运行结果`;
      } finally { runningRef.value = false; }
    });
  }

  async function openResults(): Promise<void> {
    await operate(async () => { await invoke('open_results'); });
  }

  async function initializeApp(): Promise<void> {
    if (!desktop) return;
    try {
      let saved: { serial?: string; workflow?: string } = {};
      try { saved = JSON.parse(localStorage.getItem('selection') ?? '{}'); } catch { /* Use defaults if local selections are incomplete. */ }
      selectedRef.value = saved.serial ?? '';
      workflowKeyRef.value = saved.workflow ?? '';
      const stop = await listen<Progress>('workflow-progress', event => { progressRef.value = event.payload; });
      if (disposed) { stop(); return; }
      unlisten = stop;
      applyStore(await invoke<Store>('workflow_store'));
      await refresh();
    } catch (error) { errorRef.value = String(error); }
  }
  function dispose(): void { disposed = true; unlisten?.(); }

  return { desktop, environmentRef, selectedRef, busyRef, runningRef, errorRef, noticeRef, progressRef, resultRef, readyDevicesRef, selectedDeviceRef, storeRef, workflowKeyRef, selectedWorkflowRef, syncRegistry, installWorkflow, refresh, initialize, runWorkflow, openResults, initializeApp, dispose };
});
