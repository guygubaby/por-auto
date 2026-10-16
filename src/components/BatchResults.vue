<script setup lang="ts">
import { computed, ref } from 'vue';
import { Check, LoaderCircle, Smartphone, TriangleAlert } from '@lucide/vue';
import type { DeviceRun } from '../useConnection';
import ResultPanel from './ResultPanel.vue';

const props = defineProps<{ runs: DeviceRun[]; busy: boolean }>();
defineEmits<{ openResults: [] }>();
const selectedSerialRef = ref('');
const activeRef = computed(() => props.runs.find(run => run.serial === selectedSerialRef.value) ?? props.runs[0]);
const statusNames = { queued: '排队中', running: '正在执行', completed: '已完成', failed: '失败' };
</script>

<template>
  <div class="space-y-4">
    <section v-if="runs.length" aria-labelledby="device-results-title">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 id="device-results-title" class="text-sm font-semibold">本次执行的手机</h2><p class="text-xs text-ink-muted">{{ runs.length }} 台 · 选择手机查看对应结果</p></div>
      <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="list">
        <li v-for="run in runs" :key="run.serial" class="min-w-0"><button type="button" class="flex h-full w-full items-start gap-3 rounded-control border p-3 text-left transition-colors" :class="activeRef === run ? 'border-brand bg-brand-soft/50' : 'border-line bg-surface hover:bg-surface-raised'" :aria-pressed="activeRef === run" aria-controls="device-run-result" @click="selectedSerialRef = run.serial"><Smartphone :size="20" class="mt-0.5 shrink-0 text-ink-muted" aria-hidden="true" /><span class="min-w-0"><span class="block text-sm font-medium wrap-anywhere">{{ run.model }}</span><span class="mt-1 block text-xs text-ink-muted wrap-anywhere">{{ run.serial }}</span><span class="mt-3 flex items-center gap-1.5 text-xs" :class="{ 'text-success': run.status === 'completed', 'text-danger': run.status === 'failed', 'text-brand-strong': run.status === 'running', 'text-ink-muted': run.status === 'queued' }"><LoaderCircle v-if="run.status === 'running'" :size="13" class="animate-spin" aria-hidden="true" /><Check v-else-if="run.status === 'completed'" :size="13" aria-hidden="true" /><TriangleAlert v-else-if="run.status === 'failed'" :size="13" aria-hidden="true" />{{ statusNames[run.status] }}</span></span></button></li>
      </ul>
    </section>
    <div id="device-run-result" class="space-y-3">
      <p v-if="activeRef?.error" role="alert" class="rounded-control bg-danger-soft px-4 py-3 text-sm leading-5 text-danger wrap-anywhere">{{ activeRef.model }} · {{ activeRef.serial }}：{{ activeRef.error }}</p>
      <p v-if="activeRef && !activeRef.result" class="rounded-card border border-line bg-surface px-4 py-10 text-center text-sm text-ink-secondary">{{ activeRef.status === 'failed' ? '此手机未取得运行结果，请根据上方错误排查。' : `${activeRef.model} · ${statusNames[activeRef.status]}，结果会在执行结束后显示。` }}</p>
      <ResultPanel v-else :result="activeRef?.result ?? null" :busy="busy" @open-results="$emit('openResults')" />
    </div>
  </div>
</template>
