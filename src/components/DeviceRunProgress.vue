<script setup lang="ts">
import type { DeviceRun } from '../useConnection';
defineProps<{ runs: DeviceRun[] }>();
const states = { queued: '排队中', running: '运行中', completed: '已完成', failed: '失败，请查看结果' };
</script>

<template>
  <ul class="mt-3 grid gap-2 sm:grid-cols-2" aria-label="每台手机的运行进度">
    <li v-for="run in runs" :key="run.serial" class="min-w-0 rounded-control border border-line bg-canvas/40 p-3">
      <div class="flex items-start justify-between gap-2"><span class="truncate text-xs text-ink-secondary">{{ run.model }} · {{ run.serial }}</span><span class="shrink-0 text-xs" :class="run.status === 'failed' ? 'text-danger' : run.status === 'completed' ? 'text-success' : 'text-brand-strong'">{{ states[run.status] }}</span></div>
      <p v-if="run.status === 'running' || run.status === 'queued'" class="mt-2 text-xs text-ink-muted wrap-anywhere">{{ run.progress?.message ?? '等待设备队列与执行名额' }}</p>
    </li>
  </ul>
</template>
