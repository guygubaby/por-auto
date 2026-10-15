<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Download, History, RefreshCw, Trash2 } from '@lucide/vue';
import AppButton from './AppButton.vue';
import StatusPill from './StatusPill.vue';

interface Summary { id: string; workflow_name: string; workflow_version: string; serial: string; timestamp: number; status: string; error: string | null }
interface Event { timestamp?: number; step?: number; status: string; message: string }
interface Details { summary: Summary; logs: Event[] }
const props = defineProps<{ busy: boolean; runTimestamp?: number }>();
const emit = defineEmits<{ busyChange: [value: boolean] }>();
const recordsRef = shallowRef<Summary[]>([]);
const selectedRef = shallowRef<string[]>([]);
const detailRef = shallowRef<Details | null>(null);
const detailIdRef = ref('');
const messageRef = ref('');
const errorRef = ref('');
const pendingDeleteRef = shallowRef<string[]>([]);
const confirmRef = useTemplateRef<HTMLDialogElement>('confirm');
const allSelectedRef = computed(() => recordsRef.value.length > 0 && selectedRef.value.length === recordsRef.value.length);
const statusNames: Record<string, string> = { completed: '已完成', failed: '失败', running: '未完成 / 中断', started: '开始', warning: '提示', incomplete: '日志中断' };

async function refresh(): Promise<void> {
  if (!isTauri()) return;
  recordsRef.value = await invoke<Summary[]>('list_runs');
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

onMounted(() => { void refresh().catch(error => { errorRef.value = String(error); }); });
watch(() => props.runTimestamp, () => { void refresh().catch(error => { errorRef.value = String(error); }); });
</script>

<template>
  <section id="history" class="scroll-mt-6 rounded-card border border-line bg-surface p-5">
    <div class="flex flex-wrap items-start justify-between gap-3"><div><h2 class="flex items-center gap-2 text-sm font-semibold"><History :size="18" class="text-brand-strong" aria-hidden="true" />运行记录</h2><p class="mt-2 text-xs leading-6 text-ink-muted">步骤日志与结果自动保存在本机，支持批量导出与清理。</p></div><AppButton variant="ghost" :disabled="busy" @click="operate(refresh)"><RefreshCw :size="15" aria-hidden="true" />刷新记录</AppButton></div>
    <div class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-control border border-line bg-canvas/40 p-3">
      <p class="text-xs text-ink-secondary">共 {{ recordsRef.length }} 条 · 已选 {{ selectedRef.length }} 条</p>
      <div class="flex flex-wrap gap-1"><AppButton variant="secondary" :disabled="busy || !selectedRef.length || selectedRef.length > 100" @click="exportSelected"><Download :size="15" aria-hidden="true" />导出 JSON</AppButton><AppButton variant="ghost" :disabled="busy || !selectedRef.length" @click="confirmDelete(selectedRef)"><Trash2 :size="15" aria-hidden="true" />删除所选</AppButton><AppButton variant="ghost" :disabled="busy || !recordsRef.length" @click="confirmDelete(recordsRef.map(record => record.id))">清空记录</AppButton></div>
    </div>
    <div class="mt-3 text-xs leading-6" aria-live="polite"><p v-if="errorRef" class="break-words text-danger">{{ errorRef }}</p><p v-else-if="messageRef" class="break-all text-success">{{ messageRef }}</p></div>
    <p v-if="!recordsRef.length" class="py-10 text-center text-sm text-ink-muted">还没有运行记录。执行一个工作流后，这里会自动保存日志。</p>
    <div v-else class="mt-4 overflow-x-auto">
      <table class="w-full text-left text-xs">
        <caption class="sr-only">工作流运行记录，勾选记录后可批量导出或删除</caption>
        <thead class="border-b border-line text-ink-muted"><tr><th scope="col" class="p-3"><input type="checkbox" aria-label="选择全部运行记录" :checked="allSelectedRef" :disabled="busy" @change="selectedRef = allSelectedRef ? [] : recordsRef.map(record => record.id)" /></th><th scope="col" class="p-3 font-medium">工作流 / 设备</th><th scope="col" class="p-3 font-medium">时间</th><th scope="col" class="p-3 font-medium">状态</th><th scope="col" class="p-3 font-medium">日志</th></tr></thead>
        <tbody><tr v-for="record in recordsRef" :key="record.id" class="border-b border-line/60"><td class="p-3"><input type="checkbox" :aria-label="`选择 ${record.workflow_name} ${new Date(record.timestamp).toLocaleString('zh-CN')}`" :checked="selectedRef.includes(record.id)" :disabled="busy" @change="toggle(record.id)" /></td><td class="p-3"><p class="font-medium text-ink">{{ record.workflow_name }} <span class="text-ink-muted">{{ record.workflow_version }}</span></p><p class="mt-1 break-all text-ink-muted">{{ record.serial }}</p></td><td class="whitespace-nowrap p-3 text-ink-secondary">{{ new Date(record.timestamp).toLocaleString('zh-CN') }}</td><td class="p-3"><StatusPill :tone="record.status === 'completed' ? 'success' : 'warning'">{{ statusNames[record.status] ?? record.status }}</StatusPill></td><td class="p-3"><AppButton variant="ghost" :disabled="busy" @click="showDetails(record.id)">查看日志</AppButton></td></tr></tbody>
      </table>
    </div>
    <div v-if="detailRef" class="mt-5 rounded-control border border-line bg-canvas p-4">
      <h3 class="text-sm font-medium">{{ detailRef.summary.workflow_name }} · 运行日志</h3>
      <p v-if="detailRef.summary.error" class="mt-3 break-words text-xs leading-6 text-danger">{{ detailRef.summary.error }}</p>
      <ol class="mt-3 max-h-72 space-y-2 overflow-auto text-xs" role="list"><li v-for="(event, index) in detailRef.logs" :key="index" class="flex flex-wrap gap-x-3 gap-y-1 border-b border-line/40 py-2"><time class="text-ink-muted">{{ event.timestamp ? new Date(event.timestamp).toLocaleTimeString('zh-CN') : '时间未知' }}</time><span :class="event.status === 'failed' ? 'text-danger' : 'text-brand-strong'">{{ statusNames[event.status] ?? event.status }}{{ event.step ? ` · 步骤 ${event.step}` : '' }}</span><span class="break-words text-ink-secondary">{{ event.message }}</span></li></ol>
    </div>
    <p class="mt-4 text-xs leading-6 text-ink-muted">每次最多导出 100 条。JSON 包含步骤日志、错误、工作流版本及已有的截图与页面数据，导出后可发给开发者定位问题。</p>
    <dialog ref="confirm" class="fixed inset-0 m-auto max-w-md rounded-card border border-line bg-surface p-6 text-ink shadow-2xl backdrop:bg-black/70" aria-labelledby="delete-title"><h3 id="delete-title" class="text-lg font-semibold">删除 {{ pendingDeleteRef.length }} 条运行记录？</h3><p class="mt-3 text-sm leading-7 text-ink-secondary">对应日志、结果、截图和页面结构将一并从本机删除。需要保留用于排查时，请先导出 JSON。</p><div class="mt-6 flex justify-end gap-3"><AppButton variant="secondary" autofocus @click="confirmRef?.close()">取消</AppButton><button type="button" class="min-h-10 rounded-control bg-danger px-4 text-sm font-medium text-canvas" @click="remove">确认删除</button></div></dialog>
  </section>
</template>
