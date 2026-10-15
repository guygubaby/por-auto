<script setup lang="ts">
import { LoaderCircle } from '@lucide/vue';

withDefaults(defineProps<{ variant?: 'primary' | 'secondary' | 'ghost'; loading?: boolean; disabled?: boolean }>(), { variant: 'primary', loading: false, disabled: false });
const variants = {
  primary: 'bg-brand text-white hover:bg-brand-strong',
  secondary: 'border border-line bg-surface-soft text-ink hover:bg-line',
  ghost: 'text-ink-secondary hover:bg-white/5 hover:text-ink',
};
</script>

<template>
  <button type="button" class="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-control px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45" :class="variants[variant]" :disabled="disabled || loading" :aria-busy="loading || undefined">
    <LoaderCircle v-if="loading" :size="16" class="animate-spin" aria-hidden="true" />
    <slot />
  </button>
</template>
