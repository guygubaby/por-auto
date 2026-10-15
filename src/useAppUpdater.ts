import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { version } from '../package.json';

export interface UpdateStatus {
  currentVersion: string;
  version: string | null;
  notes: string | null;
  phase: 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'installing' | 'error';
  autoCheck: boolean;
  checkedAt: number | null;
  downloaded: number;
  total: number | null;
  error: string | null;
}

export function useAppUpdater() {
  const statusRef = shallowRef<UpdateStatus>({
    currentVersion: version, version: null, notes: null, phase: 'idle', autoCheck: true,
    checkedAt: null, downloaded: 0, total: null, error: null,
  });
  const errorRef = ref('');
  const pendingRef = ref(false);
  const busyRef = computed(() => pendingRef.value || ['checking', 'downloading', 'installing'].includes(statusRef.value.phase));
  const installingRef = computed(() => ['downloading', 'installing'].includes(statusRef.value.phase));
  const percentRef = computed(() => {
    const { downloaded, total } = statusRef.value;
    return total ? Math.min(100, Math.round(downloaded / total * 100)) : null;
  });
  let stop: UnlistenFn | undefined;
  let disposed = false;
  let revision = 0;

  async function action(command: string, args?: Record<string, unknown>): Promise<void> {
    if (pendingRef.value) return;
    if (!isTauri()) { errorRef.value = '软件更新请使用安装后的桌面客户端。'; return; }
    pendingRef.value = true;
    errorRef.value = '';
    const request = ++revision;
    try {
      const status = await invoke<UpdateStatus | null>(command, args);
      if (!disposed && status && request === revision) statusRef.value = status;
    } catch (error) { if (!disposed) errorRef.value = String(error); }
    finally { pendingRef.value = false; }
  }

  onMounted(async () => {
    if (!isTauri()) return;
    try {
      const unlisten = await listen<UpdateStatus>('app-update-status', event => {
        if (!disposed) { ++revision; statusRef.value = event.payload; }
      });
      if (disposed) { unlisten(); return; }
      stop = unlisten;
      await action('update_status');
    } catch (error) { if (!disposed) errorRef.value = String(error); }
  });
  onBeforeUnmount(() => { disposed = true; ++revision; stop?.(); });

  return { statusRef, errorRef, busyRef, installingRef, percentRef, action };
}
