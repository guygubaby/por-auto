<script setup lang="ts">
import { CalendarClock, Pencil, Play, Trash2 } from '@lucide/vue';
import { RouterLink } from 'vue-router';
import { formatScheduleTime, type Schedule } from '../../useSchedules';
import AppButton from '../AppButton.vue';
import StatusPill from '../StatusPill.vue';

defineProps<{ tasks: Schedule[]; runningIds: string[]; busy: boolean }>();
const emit = defineEmits<{ edit: [task: Schedule]; remove: [task: Schedule]; run: [id: string]; toggle: [task: Schedule] }>();
const statuses: Record<string, string> = { running: '执行中', completed: '已完成', partial: '部分失败', failed: '失败', skipped: '已跳过', interrupted: '已中断' };
</script>

<template>
  <div v-if="!tasks.length" class="rounded-card border border-dashed border-line bg-surface p-10 text-center">
    <CalendarClock :size="32" class="mx-auto text-ink-muted" aria-hidden="true" /><h2 class="mt-3 text-sm font-medium">还没有定时任务</h2><p class="mt-2 text-xs leading-5 text-ink-muted">添加工作流、执行时间和手机，让重复操作按时完成。</p>
  </div>
  <ul v-else class="grid gap-3 lg:grid-cols-2" aria-label="定时任务">
    <li v-for="task in tasks" :key="task.id" class="flex min-w-0 flex-col rounded-card border border-line bg-surface p-4">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0"><h2 class="text-base font-semibold wrap-anywhere">{{ task.name }}</h2><p class="mt-2 text-xs leading-5 text-ink-muted">{{ task.snapshot.workflow.name }} · v{{ task.snapshot.workflow.version }}</p></div>
        <StatusPill :tone="runningIds.includes(task.id) ? 'warning' : task.enabled ? 'success' : 'neutral'">{{ runningIds.includes(task.id) ? '执行中' : task.enabled ? '已启用' : '已暂停' }}</StatusPill>
      </div>
      <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-control bg-surface-soft px-3 py-3"><code class="text-sm text-brand-strong">{{ task.cron }}</code><span class="text-xs text-ink-muted">{{ task.timezone }}</span></div>
      <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-xs">
        <dt class="text-ink-muted">操作手机</dt><dd class="min-w-0 text-ink-secondary"><details><summary class="cursor-pointer">{{ task.serials.length }} 台手机</summary><ul class="mt-2 max-h-32 space-y-2 overflow-auto"><li v-for="serial in task.serials" :key="serial" class="wrap-anywhere">{{ serial }}</li></ul></details></dd>
        <dt class="text-ink-muted">下次执行</dt><dd class="text-ink-secondary">{{ task.enabled ? formatScheduleTime(task.nextRunAt, task.timezone) : '已暂停' }}</dd>
        <dt class="text-ink-muted">上次执行</dt><dd class="text-ink-secondary">{{ formatScheduleTime(task.lastRunAt, task.timezone) }}<span v-if="task.lastStatus" class="ml-2" :class="task.lastStatus === 'completed' ? 'text-success' : 'text-warning'">{{ statuses[task.lastStatus] ?? task.lastStatus }}</span></dd>
      </dl>
      <p v-if="task.lastMessage" class="mt-3 text-xs leading-5 text-ink-muted wrap-anywhere">{{ task.lastMessage }}</p>
      <div class="mt-auto pt-4"><div class="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <label class="flex min-h-8 cursor-pointer items-center gap-2 text-xs text-ink-secondary has-disabled:opacity-45 pointer-coarse:min-h-11"><input type="checkbox" class="size-4 accent-brand" :checked="task.enabled" :disabled="busy" :aria-label="`启用 ${task.name}`" @change="emit('toggle', task)" />启用</label>
        <div class="flex flex-wrap items-center gap-1">
          <RouterLink :to="{ path: '/history', query: { schedule: task.id } }" class="rounded-control px-3 py-2 text-xs text-brand-strong hover:bg-brand-soft">运行日志</RouterLink>
          <AppButton variant="ghost" :disabled="busy || runningIds.includes(task.id)" :aria-label="`编辑 ${task.name}`" @click="emit('edit', task)"><Pencil :size="15" aria-hidden="true" /></AppButton>
          <AppButton variant="ghost" :disabled="busy || runningIds.includes(task.id)" :aria-label="`删除 ${task.name}`" @click="emit('remove', task)"><Trash2 :size="15" aria-hidden="true" /></AppButton>
          <AppButton variant="secondary" :disabled="busy || runningIds.includes(task.id)" @click="emit('run', task.id)"><Play :size="14" aria-hidden="true" />立即执行</AppButton>
        </div>
      </div></div>
    </li>
  </ul>
</template>
