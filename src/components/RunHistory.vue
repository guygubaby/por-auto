<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useRoute, RouterLink } from 'vue-router';
import { Download, History, RefreshCw, Trash2 } from '@lucide/vue';
import AppButton from './AppButton.vue';
import StatusPill from './StatusPill.vue';

interface Summary { id: string; workflow_name: string; workflow_version: string; serial: string; timestamp: number; status: string; error: string | null; schedule_id?: string | null; schedule_name?: string | null; trigger?: string | null }
interface Event { timestamp?: number; step?: number; status: string; message: string }
interface Details { summary: Summary; logs: Event[]; targets?: { title: string; status: string; error: string | null; updatedAt: number }[] }
const props = defineProps<{ busy: boolean; runTimestamp?: number }>();
const emit = defineEmits<{ busyChange: [value: boolean] }>();
const route = useRoute();
const scheduleIdRef = computed(() => typeof route.query.schedule === 'string' ? route.query.schedule : '');
const recordsRef = shallowRef<Summary[]>([]);
const selectedRef = shallowRef<string[]>([]);
const detailRef = shallowRef<Details | null>(null);
const detailIdRef = ref('');
const messageRef = ref('');
const errorRef = ref('');
const pendingDeleteRef = shallowRef<string[]>([]);
const confirmRef = useTemplateRef<HTMLDialogElement>('confirm');
const allSelectedRef = computed(() => recordsRef.value.length > 0 && selectedRef.value.length === recordsRef.value.length);
const statusNames: Record<string, string> = { completed: '已完成', failed: '失败', running: '执行中 / 中断', partial: '部分失败', skipped: '已跳过', interrupted: '已中断', started: '开始', warning: '提示', incomplete: '日志中断', pending: '待发送', sending: '发送中', sent: '已发送', uncertain: '结果待核对' };
let unlisten: UnlistenFn | undefined;
let disposed = false;

async function refresh(): Promise<void> {
  if (!isTauri()) return;
  const records = await invoke<Summary[]>('list_runs');
  if (disposed) return;
  recordsRef.value = scheduleIdRef.value ? records.filter(record => record.schedule_id === scheduleIdRef.value) : records;
  selectedRef.value = selectedRef.value.filter(id => recordsRef.value.some(record => record.id === id));
  if (detailIdRef.value && !recordsRef.value.some(record => record.id === detailIdRef.value)) { detailRef.value = null; detailIdRef.value = ''; }
}

async function operate(job: () => Promise<void>): Promise<void> {
  if (props.busy || !isTauri()) return;
  emit('busyChange', true);
  errorRef.value = '';
  messageRef.value = '';
  try { await job(); } catch (error) { errorRef.value = String(error); }
  finally { emit('busyChange', false); }
}

function toggle(id: string): void {
  selectedRef.value = selectedRef.value.includes(id) ? selectedRef.value.filter(value => value !== id) : [...selectedRef.value, id];
}

function confirmDelete(ids: string[]): void {
  if (!ids.length) return;
  pendingDeleteRef.value = [...ids];
  confirmRef.value?.showModal();
}

async function remove(): Promise<void> {
  confirmRef.value?.close();
  await operate(async () => {
    try { await invoke('delete_runs', { ids: pendingDeleteRef.value }); messageRef.value = `已删除 ${pendingDeleteRef.value.length} 条记录`; }
    finally { await refresh(); }
  });
}

async function exportSelected(): Promise<void> {
  await operate(async () => {
    const path = await invoke<string | null>('export_runs', { ids: selectedRef.value });
    if (path) messageRef.value = `已导出 ${selectedRef.value.length} 条记录：${path}`;
  });
}

async function showDetails(id: string): Promise<void> {
  if (props.busy) return;
  detailIdRef.value = id;
  await operate(async () => {
    const details = await invoke<Details>('run_details', { id });
    if (detailIdRef.value === id) detailRef.value = details;
  });
}

onMounted(async () => {
  try {
    if (isTauri()) {
      const stop = await listen('history-changed', () => { void refresh().catch(error => { errorRef.value = String(error); }); });
      if (disposed) { stop(); return; }
      unlisten = stop;
    }
    await refresh();
  } catch (error) { errorRef.value = String(error); }
});
onBeforeUnmount(() => { disposed = true; unlisten?.(); });
watch(() => props.runTimestamp, () => { void refresh().catch(error => { errorRef.value = String(error); }); });
watch(scheduleIdRef, () => {
  selectedRef.value = [];
  detailRef.value = null;
  detailIdRef.value = '';
  void refresh().catch(error => { errorRef.value = String(error); });
});
</script>

<template>
  <section id="history" class="scroll-mt-6 rounded-card border border-line bg-surface p-4">
    <div class="flex flex-wrap items-start justify-between gap-3"><div><h2 class="flex items-center gap-2 text-sm font-semibold"><History :size="18" class="text-brand-strong" aria-hidden="true" />运行记录</h2><p class="mt-2 text-xs leading-5 text-ink-muted">步骤日志与结果自动保存在本机，支持批量导出与清理。</p></div><AppButton variant="ghost" :disabled="busy" @click="operate(refresh)"><RefreshCw :size="15" aria-hidden="true" />刷新记录</AppButton></div>
    <p v-if="scheduleIdRef" class="mt-3 text-xs text-ink-secondary">正在查看所选定时任务的记录 <RouterLink to="/history" class="ml-3 text-brand-strong">查看全部记录</RouterLink></p>
    <div class="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-control border border-line bg-canvas/40 p-3">
      <p class="text-xs text-ink-secondary">共 {{ recordsRef.length }} 条 · 已选 {{ selectedRef.length }} 条</p>
      <div class="flex flex-wrap gap-1"><AppButton variant="secondary" :disabled="busy || !selectedRef.length || selectedRef.length > 100" @click="exportSelected"><Download :size="15" aria-hidden="true" />导出 JSON</AppButton><AppButton variant="ghost" :disabled="busy || !selectedRef.length" @click="confirmDelete(selectedRef)"><Trash2 :size="15" aria-hidden="true" />删除所选</AppButton><AppButton variant="ghost" :disabled="busy || !recordsRef.length" @click="confirmDelete(recordsRef.map(record => record.id))">清空记录</AppButton></div>
    </div>
    <div class="mt-3 text-xs leading-5" aria-live="polite"><p v-if="errorRef" class="break-words text-danger">{{ errorRef }}</p><p v-else-if="messageRef" class="break-all text-success">{{ messageRef }}</p></div>
    <p v-if="!recordsRef.length" class="py-10 text-center text-sm text-ink-muted">还没有运行记录。执行一个工作流后，这里会自动保存日志。</p>
    <div v-else class="mt-3 overflow-x-auto">
      <table class="w-full text-left text-xs">
        <caption class="sr-only">工作流运行记录，勾选记录后可批量导出或删除</caption>
        <thead class="border-b border-line text-ink-muted"><tr><th scope="col" class="p-3"><input type="checkbox" aria-label="选择全部运行记录" :checked="allSelectedRef" :disabled="busy" @change="selectedRef = allSelectedRef ? [] : recordsRef.map(record => record.id)" /></th><th scope="col" class="p-3 font-medium">工作流 / 设备</th><th scope="col" class="p-3 font-medium">时间</th><th scope="col" class="p-3 font-medium">状态</th><th scope="col" class="p-3 font-medium">日志</th></tr></thead>
        <tbody><tr v-for="record in recordsRef" :key="record.id" class="border-b border-line/60"><td class="p-3"><input type="checkbox" :aria-label="`选择 ${record.workflow_name} ${new Date(record.timestamp).toLocaleString('zh-CN')}`" :checked="selectedRef.includes(record.id)" :disabled="busy" @change="toggle(record.id)" /></td><td class="p-3"><p class="font-medium text-ink">{{ record.workflow_name }} <span class="text-ink-muted">{{ record.workflow_version }}</span></p><p class="mt-1 break-all text-ink-muted">{{ record.serial }}</p><p v-if="record.schedule_name" class="mt-1 text-brand-strong">{{ record.schedule_name }} · {{ record.trigger === 'cron' ? '定时触发' : '手动触发' }}</p></td><td class="whitespace-nowrap p-3 text-ink-secondary">{{ new Date(record.timestamp).toLocaleString('zh-CN') }}</td><td class="p-3"><StatusPill :tone="record.status === 'completed' ? 'success' : 'warning'">{{ statusNames[record.status] ?? record.status }}</StatusPill></td><td class="p-3"><AppButton variant="ghost" :disabled="busy" @click="showDetails(record.id)">查看日志</AppButton></td></tr></tbody>
      </table>
    </div>
    <div v-if="detailRef" class="mt-4 rounded-control border border-line bg-canvas p-3">
      <h3 class="text-sm font-medium">{{ detailRef.summary.workflow_name }} · 运行日志</h3>
      <p v-if="detailRef.summary.error" class="mt-3 break-words text-xs leading-5 text-danger">{{ detailRef.summary.error }}</p>
      <div v-if="detailRef.targets?.length" class="mt-3 overflow-auto"><h4 class="mb-2 text-xs font-medium">逐会话结果 · {{ detailRef.targets.filter(t => t.status === 'sent').length }} / {{ detailRef.targets.length }} 已发送</h4><table class="w-full text-left text-xs"><caption class="sr-only">每个接收会话的发送结果</caption><thead><tr class="border-b border-line text-ink-muted"><th class="py-2 font-normal">会话</th><th class="py-2 font-normal">状态</th><th class="py-2 font-normal">详情</th></tr></thead><tbody><tr v-for="target in detailRef.targets" :key="target.title" class="border-b border-line/40"><td class="py-2 pr-3 wrap-anywhere">{{ target.title }}</td><td class="whitespace-nowrap py-2 pr-3" :class="target.status === 'sent' ? 'text-success' : 'text-warning'">{{ statusNames[target.status] ?? target.status }}</td><td class="py-2 text-ink-muted wrap-anywhere">{{ target.error ?? '—' }}</td></tr></tbody></table></div>
      <ol class="mt-3 max-h-72 space-y-2 overflow-auto text-xs" role="list"><li v-for="(event, index) in detailRef.logs" :key="index" class="flex flex-wrap gap-x-3 gap-y-1 border-b border-line/40 py-2"><time class="text-ink-muted">{{ event.timestamp ? new Date(event.timestamp).toLocaleTimeString('zh-CN') : '时间未知' }}</time><span :class="event.status === 'failed' ? 'text-danger' : 'text-brand-strong'">{{ statusNames[event.status] ?? event.status }}{{ event.step ? ` · 步骤 ${event.step}` : '' }}</span><span class="break-words text-ink-secondary">{{ event.message }}</span></li></ol>
    </div>
    <p class="mt-3 text-xs leading-5 text-ink-muted">每次最多导出 100 条。JSON 包含步骤日志、错误、工作流版本及已有的截图与页面数据，导出后可发给开发者定位问题。</p>
    <dialog ref="confirm" class="fixed inset-0 m-auto max-w-md rounded-card border border-line bg-surface p-4 text-ink shadow-2xl backdrop:bg-black/70" aria-labelledby="delete-title"><h3 id="delete-title" class="text-lg font-semibold">删除 {{ pendingDeleteRef.length }} 条运行记录？</h3><p class="mt-3 text-sm leading-5 text-ink-secondary">对应日志、结果、截图和页面结构将一并从本机删除。需要保留用于排查时，请先导出 JSON。</p><div class="mt-4 flex justify-end gap-3"><AppButton variant="secondary" autofocus @click="confirmRef?.close()">取消</AppButton><button type="button" class="min-h-8 rounded-control bg-danger px-4 text-sm font-medium text-canvas pointer-coarse:min-h-11" @click="remove">确认删除</button></div></dialog>
  </section>
</template>
