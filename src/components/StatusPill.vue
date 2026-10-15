<script setup lang="ts">
withDefaults(defineProps<{ tone?: 'success' | 'warning' | 'neutral' }>(), { tone: 'neutral' });
const tones = { success: 'bg-success-soft text-success', warning: 'bg-warning-soft text-warning', neutral: 'bg-white/5 text-ink-secondary' };
</script>

<template>
  <span class="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium" :class="tones[tone]">
    <span class="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" /><slot />
  </span>
</template>
