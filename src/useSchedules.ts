import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Installed } from './useConnection';

export interface Schedule {
  id: string;
  name: string;
  enabled: boolean;
  cron: string;
  timezone: string;
  serials: string[];
  snapshot: Installed;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastStatus: string | null;
  lastMessage: string | null;
}
export interface ScheduleInput {
  id: string | null;
  name: string;
  enabled: boolean;
  cron: string;
  timezone: string;
  serials: string[];
  workflowKey: string;
  updateWorkflow: boolean;
}
interface ScheduleView { tasks: Schedule[]; runningIds: string[]; error: string | null }

export function formatScheduleTime(timestamp: number | null, timezone: string): string {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '时间无效';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).format(date);
  } catch {
    // The native scheduler's IANA database may be newer than the system WebView.
    return `${date.toISOString()} (UTC)`;
  }
}

export function useSchedules() {
  const viewRef = shallowRef<ScheduleView>({ tasks: [], runningIds: [], error: null });
  const busyRef = ref(false);
  const errorRef = ref('');
  let stop: UnlistenFn | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let disposed = false;
  let revision = 0;

  async function refresh(): Promise<void> {
    if (!isTauri() || busyRef.value) return;
    const request = ++revision;
    try {
      const view = await invoke<ScheduleView>('list_schedules');
      if (!disposed && request === revision) viewRef.value = view;
    } catch (error) { if (!disposed && request === revision) errorRef.value = String(error); }
  }

  async function change(command: string, args: Record<string, unknown>): Promise<boolean> {
    if (busyRef.value) return false;
    if (!isTauri()) { errorRef.value = '请在桌面客户端中配置定时任务。'; return false; }
    busyRef.value = true;
    errorRef.value = '';
    ++revision;
    try { viewRef.value = await invoke<ScheduleView>(command, args); return true; }
    catch (error) { errorRef.value = String(error); return false; }
    finally { busyRef.value = false; }
  }

  onMounted(async () => {
    if (!isTauri()) return;
    const unlisten = await listen('schedules-changed', () => { void refresh(); })
      .catch(error => { errorRef.value = String(error); return undefined; });
    if (disposed) { unlisten?.(); return; }
    stop = unlisten;
    await refresh();
    if (!disposed) timer = setInterval(() => { void refresh(); }, 5000);
  });
  onBeforeUnmount(() => { disposed = true; ++revision; stop?.(); clearInterval(timer); });
  return { viewRef, busyRef, errorRef, refresh, change };
}
