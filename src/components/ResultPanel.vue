<script setup lang="ts">
import { Check, CircleUserRound, FolderOpen, ScanLine, TriangleAlert } from '@lucide/vue';
import type { RunResult } from '../useConnection';
import AppButton from './AppButton.vue';

defineProps<{ result: RunResult | null; busy: boolean }>();
defineEmits<{ openResults: [] }>();
</script>

<template>
  <section id="result" class="scroll-mt-6 rounded-card border border-line bg-surface">
    <div class="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
      <h2 class="text-sm font-semibold">运行结果</h2>
      <AppButton variant="ghost" :disabled="busy || !result" @click="$emit('openResults')"><FolderOpen :size="15" aria-hidden="true" />打开结果目录</AppButton>
    </div>
    <div v-if="!result" class="flex min-h-52 flex-col items-center justify-center gap-3 p-5 text-center">
      <div class="grid size-12 place-items-center rounded-2xl border border-line bg-surface-raised"><ScanLine :size="23" class="text-ink-muted" aria-hidden="true" /></div>
      <p class="text-sm text-ink-secondary">运行工作流后，在这里查看输出与手机截图</p>
      <p class="text-xs text-ink-muted">结果保存在这台电脑上</p>
    </div>
    <div v-else class="grid gap-4 p-4 sm:grid-cols-2">
      <div class="min-w-0">
        <div class="mb-4 flex items-center gap-2 text-sm" :class="result.error ? 'text-warning' : 'text-success'">
          <TriangleAlert v-if="result.error" :size="18" aria-hidden="true" /><Check v-else :size="18" aria-hidden="true" />{{ result.error ? '本次执行未完成' : '工作流执行完成' }}
        </div>
        <CircleUserRound :size="28" class="mb-3 text-brand-strong" aria-hidden="true" />
        <p class="break-words text-2xl font-semibold">{{ result.nickname ?? (result.error ? '未取得结果' : '执行成功') }}</p>
        <dl class="mt-4 space-y-3 text-xs">
          <div><dt class="text-ink-muted">工作流</dt><dd class="mt-1 text-ink-secondary">{{ result.workflow_name }} · {{ result.workflow_version }}</dd></div>
          <div v-for="(value, field) in result.outputs" :key="field"><dt class="text-ink-muted">{{ field === 'nickname' ? '昵称' : field }}</dt><dd class="mt-1 break-words text-ink-secondary">{{ value }}</dd></div>
          <div><dt class="text-ink-muted">手机序列号</dt><dd class="mt-1 break-all text-ink-secondary">{{ result.serial }}</dd></div>
          <div><dt class="text-ink-muted">执行时间</dt><dd class="mt-1 text-ink-secondary">{{ new Date(result.timestamp).toLocaleString('zh-CN') }}</dd></div>
        </dl>
        <p v-if="result.warning" class="mt-4 text-xs leading-5 text-warning">工作流已结束，但截图未保存：{{ result.warning }}</p>
      </div>
      <figure class="flex flex-col items-center rounded-2xl border border-line bg-canvas p-3">
        <img v-if="result.screenshot" :src="`data:image/png;base64,${result.screenshot}`" class="max-h-96 max-w-full rounded-lg object-contain" alt="本次工作流执行结束时的手机页面截图" />
        <p v-else class="py-12 text-sm text-ink-muted">未取得手机截图</p>
        <figcaption class="mt-3 text-xs text-ink-muted">本次操作截图</figcaption>
      </figure>
    </div>
  </section>
</template>
