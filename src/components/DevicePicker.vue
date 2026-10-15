<script setup lang="ts">
import { computed, useId } from 'vue';
import { Smartphone } from '@lucide/vue';
import type { Device } from '../useConnection';

const props = withDefaults(defineProps<{ devices: Device[]; disabled: boolean; selectAllLabel?: string }>(), { selectAllLabel: '全选已授权手机' });
const helpId = useId();
const selectedRef = defineModel<string[]>({ required: true });
const countRef = computed(() => props.devices.filter(device => selectedRef.value.includes(device.serial)).length);
const allSelectedRef = computed(() => props.devices.length > 0 && countRef.value === props.devices.length);

function toggle(serial: string): void {
  if (props.disabled) return;
  selectedRef.value = selectedRef.value.includes(serial) ? selectedRef.value.filter(value => value !== serial) : [...selectedRef.value, serial];
}

function toggleAll(): void {
  if (props.disabled) return;
  selectedRef.value = allSelectedRef.value ? [] : props.devices.map(device => device.serial);
}
</script>

<template>
  <fieldset :disabled="disabled" class="min-w-0 w-full" :aria-describedby="helpId">
    <legend class="mb-2 text-xs text-ink-muted">操作手机</legend>
    <div class="overflow-hidden rounded-control border border-line bg-surface-soft/50">
      <div class="flex flex-wrap items-center justify-between gap-x-3 border-b border-line px-3">
        <label class="flex min-h-9 cursor-pointer items-center gap-2.5 text-sm has-disabled:cursor-not-allowed has-disabled:opacity-50 pointer-coarse:min-h-11"><input type="checkbox" class="size-4 shrink-0 accent-brand" :checked="allSelectedRef" :indeterminate.prop="countRef > 0 && !allSelectedRef" :disabled="!devices.length" @change="toggleAll" />{{ selectAllLabel }}</label>
        <span class="py-2 text-xs text-ink-muted" aria-live="polite">已选 {{ countRef }} / {{ devices.length }} 台</span>
      </div>
      <ul v-if="devices.length" class="grid max-h-40 gap-2 overflow-y-auto p-3 sm:grid-cols-2" role="list">
        <li v-for="device in devices" :key="device.serial" class="min-w-0">
          <label class="flex min-h-12 cursor-pointer items-center gap-3 rounded-control border px-3 py-2.5 transition-colors has-disabled:cursor-not-allowed has-disabled:opacity-50" :class="selectedRef.includes(device.serial) ? 'border-brand/60 bg-brand-soft/60' : 'border-line bg-surface hover:bg-surface-raised'">
            <input type="checkbox" class="size-4 shrink-0 accent-brand" :checked="selectedRef.includes(device.serial)" @change="toggle(device.serial)" />
            <Smartphone :size="18" class="shrink-0 text-ink-muted" aria-hidden="true" />
            <span class="min-w-0"><span class="block text-sm wrap-anywhere">{{ device.model }}<span v-if="device.state !== 'device'" class="ml-2 text-xs text-warning">离线 / 未授权</span></span><span class="mt-1 block text-xs text-ink-muted wrap-anywhere">{{ device.serial }}</span></span>
          </label>
        </li>
      </ul>
      <p v-else class="px-3 py-5 text-sm text-ink-muted">暂无已授权手机，请连接手机并允许 USB 调试后刷新设备。</p>
    </div>
    <p :id="helpId" class="mt-2 text-xs leading-5 text-ink-muted">可选择多台手机，工作流将依次执行。一台失败会继续处理其余手机。</p>
  </fieldset>
</template>
