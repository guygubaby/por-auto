<script setup lang="ts">
import { computed, ref, shallowRef, useTemplateRef } from 'vue';
import { storeToRefs } from 'pinia';
import { Plus, RefreshCw } from '@lucide/vue';
import { useConnectionStore } from '../../useConnection';
import { useSchedules, type Schedule, type ScheduleInput } from '../../useSchedules';
import AppButton from '../AppButton.vue';
import ScheduleDialog from './ScheduleDialog.vue';
import ScheduleList from './ScheduleList.vue';

const connection = useConnectionStore();
const { storeRef, readyDevicesRef, busyRef: connectionBusyRef } = storeToRefs(connection);
const { viewRef, busyRef, errorRef, refresh, change } = useSchedules();
const openRef = ref(false);
const editingRef = shallowRef<Schedule | null>(null);
const deletingRef = shallowRef<Schedule | null>(null);
const confirmRef = useTemplateRef<HTMLDialogElement>('confirm');
const enabledCountRef = computed(() => viewRef.value.tasks.filter(t => t.enabled).length);

function edit(task: Schedule | null): void {
  editingRef.value = task;
  errorRef.value = '';
  openRef.value = true;
}
async function save(input: ScheduleInput): Promise<void> {
  if (await change('save_schedule', { input })) openRef.value = false;
}
function confirmDelete(task: Schedule): void { deletingRef.value = task; confirmRef.value?.showModal(); }
async function remove(): Promise<void> {
  if (!deletingRef.value) return;
  if (await change('delete_schedule', { id: deletingRef.value.id })) {
    confirmRef.value?.close();
    deletingRef.value = null;
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-xs text-ink-muted">共 {{ viewRef.tasks.length }} 个任务 · {{ enabledCountRef }} 个已启用 · {{ viewRef.runningIds.length }} 个运行中</p>
      <div class="flex flex-wrap gap-2"><AppButton variant="ghost" :disabled="busyRef || connectionBusyRef" @click="refresh(); connection.refresh()"><RefreshCw :size="15" aria-hidden="true" />刷新</AppButton><AppButton :disabled="busyRef || !!viewRef.error" @click="edit(null)"><Plus :size="16" aria-hidden="true" />新建定时任务</AppButton></div>
    </div>
    <p class="rounded-control border border-warning/20 bg-warning-soft px-4 py-3 text-xs leading-5 text-warning">请保持桌面客户端运行、电脑唤醒及手机连接。最小化后仍会调度；退出软件后停止，重新打开不补跑错过的时间。</p>
    <p v-if="viewRef.error || (errorRef && !openRef)" role="alert" class="rounded-control border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger wrap-anywhere">{{ viewRef.error || errorRef }}</p>
    <ScheduleList :tasks="viewRef.tasks" :running-ids="viewRef.runningIds" :busy="busyRef || !!viewRef.error" @edit="edit" @remove="confirmDelete" @run="change('run_schedule_now', { id: $event })" @toggle="change('set_schedule_enabled', { id: $event.id, enabled: !$event.enabled })" />
    <details class="rounded-control border border-line bg-surface p-3 text-xs leading-5 text-ink-muted">
      <summary class="cursor-pointer text-ink-secondary">执行规则与 Cron 格式</summary>
      <ul class="mt-3 list-disc space-y-2 pl-5">
        <li>标准五段：分（0–59）时（0–23）日（1–31）月（1–12）周（0–7）。支持 *、逗号列表、范围和 / 步长；周日为 0 或 7。日和周同时受限时，满足任意一个即执行。</li>
        <li>时间按任务的 IANA 时区计算。夏令时不存在的本地时刻会跳过；重复的本地时刻只执行第一次。</li>
        <li>错过时点不补跑；正常轮询允许 10 秒调度宽限。上一轮未结束时，本轮跳过并保存日志。维护期间不启动设备任务。</li>
        <li>最多同时运行 4 台手机，同一手机的不同任务按到达顺序排队。单台断开、未授权或运行失败会记录原因，并继续其余手机。不会自动重试。</li>
        <li>保存工作流版本、输入和 Hook 快照。若需采用新版本或新配置，请编辑任务并明确更新快照。暂停仅停止后续调度，当前批次继续完成；立即执行也可用于已暂停任务。</li>
      </ul>
    </details>
  </div>
  <ScheduleDialog :open="openRef" :task="editingRef" :workflows="storeRef.installed" :devices="readyDevicesRef" :busy="busyRef" :error="errorRef" @close="openRef = false" @save="save" />
  <dialog ref="confirm" class="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-card border border-line bg-surface p-4 text-ink shadow-2xl backdrop:bg-black/70" aria-labelledby="delete-schedule-title">
    <h2 id="delete-schedule-title" class="text-lg font-semibold">删除定时任务？</h2><p class="mt-3 text-sm leading-5 text-ink-secondary">「{{ deletingRef?.name }}」将停止调度。已有运行记录会保留，可以单独导出或清理。</p>
    <p v-if="errorRef" role="alert" class="mt-3 text-xs text-danger">{{ errorRef }}</p>
    <div class="mt-4 flex justify-end gap-3"><AppButton variant="secondary" :disabled="busyRef" autofocus @click="confirmRef?.close()">取消</AppButton><AppButton :disabled="busyRef" @click="remove">确认删除</AppButton></div>
  </dialog>
</template>
