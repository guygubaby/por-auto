<script setup lang="ts">
import { computed, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { X } from '@lucide/vue';
import type { Device, Installed } from '../../useConnection';
import { formatScheduleTime, type Schedule, type ScheduleInput } from '../../useSchedules';
import AppButton from '../AppButton.vue';
import DevicePicker from '../DevicePicker.vue';

const props = defineProps<{ open: boolean; task: Schedule | null; workflows: Installed[]; devices: Device[]; busy: boolean; error: string }>();
const emit = defineEmits<{ close: []; save: [input: ScheduleInput] }>();
const dialogRef = useTemplateRef<HTMLDialogElement>('dialog');
const nameRef = ref('');
const cronRef = ref('0 9 * * *');
const timezoneRef = ref(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai');
const enabledRef = ref(true);
const workflowKeyRef = ref('');
const serialsRef = shallowRef<string[]>([]);
const updateWorkflowRef = ref(false);
const timesRef = shallowRef<number[]>([]);
const validationErrorRef = ref('');
const checkingRef = ref(false);
const timezones = ['Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Singapore', 'UTC', 'Europe/London', 'America/New_York', 'America/Los_Angeles'];
const presets = [
  { name: '每天 09:00', cron: '0 9 * * *' },
  { name: '工作日 09:00', cron: '0 9 * * 1-5' },
  { name: '每小时', cron: '0 * * * *' },
  { name: '每 30 分钟', cron: '*/30 * * * *' },
];
const choicesRef = computed(() => {
  const choices = [...props.workflows];
  if (props.task && !choices.some(w => w.key === props.task?.snapshot.key)) choices.unshift(props.task.snapshot);
  return choices;
});
const devicesRef = computed(() => [
  ...props.devices,
  ...(props.task?.serials ?? []).filter(serial => !props.devices.some(d => d.serial === serial))
    .map(serial => ({ serial, state: 'offline', model: '已保存的手机' })),
]);
const newerRef = computed(() => {
  const task = props.task;
  const installed = props.workflows.find(w => w.key === workflowKeyRef.value);
  return task && installed && installed.key === task.snapshot.key
    && (installed.workflow.version !== task.snapshot.workflow.version || installed.commit !== task.snapshot.commit);
});

watch(() => props.open, open => {
  if (open) {
    const task = props.task;
    nameRef.value = task?.name ?? '';
    cronRef.value = task?.cron ?? '0 9 * * *';
    timezoneRef.value = task?.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai');
    enabledRef.value = task?.enabled ?? true;
    workflowKeyRef.value = task?.snapshot.key ?? props.workflows[0]?.key ?? '';
    serialsRef.value = [...(task?.serials ?? props.devices.map(d => d.serial))];
    updateWorkflowRef.value = false;
    validationErrorRef.value = '';
    timesRef.value = [];
    dialogRef.value?.showModal();
  } else dialogRef.value?.close();
});
watch([cronRef, timezoneRef], () => { timesRef.value = []; validationErrorRef.value = ''; });

async function preview(): Promise<boolean> {
  if (checkingRef.value) return false;
  checkingRef.value = true;
  validationErrorRef.value = '';
  const cron = cronRef.value.trim();
  const timezone = timezoneRef.value.trim();
  try {
    if (!isTauri()) throw new Error('Cron 校验和执行时间预览请使用桌面客户端。');
    const times = await invoke<number[]>('preview_cron', { cron, timezone });
    if (cron !== cronRef.value.trim() || timezone !== timezoneRef.value.trim() || !props.open) return false;
    timesRef.value = times;
    return true;
  } catch (error) {
    validationErrorRef.value = String(error);
    return false;
  } finally { checkingRef.value = false; }
}

async function submit(): Promise<void> {
  if (props.busy || checkingRef.value) return;
  if (!serialsRef.value.length) { validationErrorRef.value = '请至少选择一台手机。'; return; }
  if (!await preview()) return;
  emit('save', {
    id: props.task?.id ?? null, name: nameRef.value.trim(), enabled: enabledRef.value,
    cron: cronRef.value.trim(), timezone: timezoneRef.value.trim(), serials: [...serialsRef.value],
    workflowKey: workflowKeyRef.value, updateWorkflow: updateWorkflowRef.value,
  });
}
</script>

<template>
  <dialog ref="dialog" class="fixed inset-0 m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-card border border-line bg-surface p-4 text-ink shadow-2xl backdrop:bg-black/70" aria-labelledby="schedule-title" aria-describedby="schedule-description" @cancel.prevent="!busy && emit('close')" @close="emit('close')">
    <div class="flex items-start justify-between gap-3">
      <div><h2 id="schedule-title" class="text-lg font-semibold">{{ task ? '编辑定时任务' : '新建定时任务' }}</h2><p id="schedule-description" class="mt-2 text-sm text-ink-secondary">设置执行时间、工作流和操作手机，配置保存在本机。</p></div>
      <button type="button" :disabled="busy" class="grid size-8 shrink-0 place-items-center rounded-control text-ink-muted hover:bg-surface-soft disabled:opacity-45 pointer-coarse:size-11" aria-label="关闭定时任务弹窗" @click="emit('close')"><X :size="18" aria-hidden="true" /></button>
    </div>
    <form class="mt-4 space-y-4" :aria-busy="busy || checkingRef" @submit.prevent="submit">
      <fieldset :disabled="busy || checkingRef" class="min-w-0 space-y-4">
        <legend class="sr-only">定时任务配置</legend>
        <div class="grid items-start gap-4 sm:grid-cols-2">
        <div><label for="schedule-name" class="mb-2 block text-xs text-ink-secondary">任务名称</label><input id="schedule-name" v-model="nameRef" required autofocus maxlength="60" class="min-h-9 w-full rounded-control border border-line bg-surface-soft px-3 text-sm pointer-coarse:min-h-11" placeholder="例如：每日设备检查" /></div>
        <div><label for="schedule-workflow" class="mb-2 block text-xs text-ink-secondary">工作流</label><select id="schedule-workflow" v-model="workflowKeyRef" required class="min-h-9 w-full rounded-control border border-line bg-surface-soft px-3 text-sm pointer-coarse:min-h-11"><option value="" disabled>请选择已安装的工作流</option><option v-for="item in choicesRef" :key="item.key" :value="item.key">{{ item.workflow.name }} · {{ item.workflow.version }}</option></select>
          <p class="mt-2 text-xs leading-5 text-ink-muted">保存时固定工作流快照，商店更新不会自动改变此任务。</p>
          <p v-if="task && workflowKeyRef === task.snapshot.key" class="text-xs leading-5 text-ink-secondary">当前固定版本：{{ task.snapshot.workflow.version }} · {{ task.snapshot.commit.slice(0, 8) }}</p>
          <label v-if="newerRef" class="mt-2 flex items-center gap-2 text-xs text-warning"><input v-model="updateWorkflowRef" type="checkbox" class="size-4 accent-brand" />将快照更新为当前已安装版本（保存后生效）</label>
        </div>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <div><label for="schedule-cron" class="mb-2 block text-xs text-ink-secondary">Cron 表达式</label><input id="schedule-cron" v-model="cronRef" required maxlength="200" spellcheck="false" :aria-invalid="!!validationErrorRef" aria-describedby="cron-help schedule-form-error" class="min-h-9 w-full rounded-control border border-line bg-surface-soft px-3 font-mono text-sm pointer-coarse:min-h-11" /><p id="cron-help" class="mt-2 text-xs leading-5 text-ink-muted">分 时 日 月 周 · 周日为 0 或 7</p></div>
          <div><label for="schedule-timezone" class="mb-2 block text-xs text-ink-secondary">执行时区</label><input id="schedule-timezone" v-model="timezoneRef" required list="schedule-zones" maxlength="100" spellcheck="false" class="min-h-9 w-full rounded-control border border-line bg-surface-soft px-3 text-sm pointer-coarse:min-h-11" /><datalist id="schedule-zones"><option v-for="zone in timezones" :key="zone" :value="zone" /></datalist><p class="mt-2 text-xs leading-5 text-ink-muted">使用 IANA 时区，默认当前电脑时区。</p></div>
        </div>
        <div class="flex flex-wrap gap-2"><button v-for="preset in presets" :key="preset.cron" type="button" class="rounded-control border border-line bg-surface-soft px-3 py-2 text-xs text-ink-secondary hover:text-ink" @click="cronRef = preset.cron">{{ preset.name }}</button></div>
        <DevicePicker v-model="serialsRef" :devices="devicesRef" :disabled="busy || checkingRef" select-all-label="全选列表手机" />
        <p v-if="task" class="text-xs leading-5 text-ink-muted">已保存的离线手机仍会保留。运行时未连接或未授权会记录失败，并继续其他手机。</p>
        <label class="flex min-h-8 items-center gap-3 text-sm pointer-coarse:min-h-11"><input v-model="enabledRef" type="checkbox" class="size-4 accent-brand" />启用此任务</label>
      </fieldset>
      <div class="rounded-control border border-line bg-canvas/40 p-3">
        <div class="flex flex-wrap items-center justify-between gap-2"><h3 class="text-xs font-medium text-ink-secondary">接下来 5 次执行</h3><AppButton variant="ghost" :disabled="busy" :loading="checkingRef" @click="preview">校验并预览</AppButton></div>
        <ol v-if="timesRef.length" class="mt-2 space-y-2 font-mono text-xs text-brand-strong"><li v-for="time in timesRef" :key="time">{{ formatScheduleTime(time, timezoneRef.trim()) }}</li></ol>
        <p v-else class="mt-2 text-xs text-ink-muted">按所选时区计算，保存时会再次校验。</p>
      </div>
      <p id="schedule-form-error" role="alert" class="text-xs leading-5 text-danger wrap-anywhere">{{ validationErrorRef || error }}</p>
      <div class="flex flex-wrap justify-end gap-3 border-t border-line pt-4"><AppButton variant="secondary" :disabled="busy" @click="emit('close')">取消</AppButton><button type="submit" :disabled="busy || checkingRef || !workflowKeyRef" class="min-h-8 rounded-control bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:min-h-11">{{ busy ? '正在保存…' : '保存任务' }}</button></div>
    </form>
  </dialog>
</template>
