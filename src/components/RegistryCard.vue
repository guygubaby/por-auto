<script setup lang="ts">
import { Check, GitBranch, GitFork, LockKeyhole } from '@lucide/vue';
import { isOfficialRegistry, type Registry } from '../useConnection';

defineProps<{ registry: Registry; selected: boolean; disabled: boolean }>();
defineEmits<{ select: [] }>();
</script>

<template>
  <button
    type="button"
    class="flex h-full w-full min-w-0 flex-col rounded-card border p-4 text-left transition-colors disabled:cursor-wait"
    :class="selected ? 'border-brand bg-brand-soft/50' : 'border-line bg-surface hover:border-ink-muted hover:bg-surface-raised'"
    :aria-pressed="selected"
    aria-controls="registry-workflows"
    :disabled="disabled"
    @click="$emit('select')"
  >
    <span class="mb-4 flex w-full items-center justify-between gap-3">
      <span class="grid size-8 place-items-center rounded-control" :class="selected ? 'bg-brand-soft text-brand-strong' : 'bg-surface-soft text-ink-secondary'"><GitFork :size="21" aria-hidden="true" /></span>
      <span v-if="isOfficialRegistry(registry)" class="mr-auto inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand-strong"><LockKeyhole :size="12" aria-hidden="true" />官方 · 常驻</span>
      <span class="grid size-5 shrink-0 place-items-center rounded-full border" :class="selected ? 'border-brand bg-brand text-white' : 'border-line'" aria-hidden="true"><Check v-if="selected" :size="13" /></span>
    </span>
    <span class="text-sm leading-5 font-semibold wrap-anywhere">{{ registry.name }}</span>
    <span class="mt-1.5 mb-4 text-xs leading-5 text-ink-muted wrap-anywhere">{{ registry.url.replace('https://github.com/', '') }}</span>
    <span class="mt-auto flex w-full flex-wrap items-center justify-between gap-2 border-t border-line/70 pt-3 text-xs text-ink-secondary">
      <span class="inline-flex min-w-0 items-center gap-1.5 wrap-anywhere"><GitBranch :size="13" class="shrink-0" aria-hidden="true" />{{ registry.reference }}</span>
      <span>{{ registry.workflows.length }} 个工作流</span>
    </span>
  </button>
</template>
