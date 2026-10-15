<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue';
import { storeToRefs } from 'pinia';
import { ChevronRight, Download, Monitor, RefreshCw, ShieldCheck, Smartphone, Stethoscope, Usb, X } from '@lucide/vue';
import { RouterLink } from 'vue-router';
import { useConnectionStore } from '../useConnection';
import AppButton from './AppButton.vue';
import StatusPill from './StatusPill.vue';

const connection = useConnectionStore();
const { environmentRef, readyDevicesRef, busyRef, runningRef, progressRef, errorRef } = storeToRefs(connection);
const dialogRef = useTemplateRef<HTMLDialogElement>('doctor');
const actionRef = ref<'check' | 'initialize' | null>(null);
const doctorErrorRef = ref('');
const checkedAtRef = ref('');
const stateLabels: Record<string, string> = { device: '已授权', unauthorized: '等待 USB 授权', offline: '设备离线', recovery: '恢复模式', sideload: '刷机模式', no: '连接权限不足' };
const healthyRef = computed(() => environmentRef.value?.ready && readyDevicesRef.value.length > 0 && !doctorErrorRef.value);
const componentStatusRef = computed(() => {
  if (!environmentRef.value) return '待检测';
  return environmentRef.value.ready ? '已就绪' : '待初始化';
});
const phoneStatusRef = computed(() => {
  if (!environmentRef.value) return '待检测';
  if (readyDevicesRef.value.length) return `${readyDevicesRef.value.length} 台已授权`;
  return environmentRef.value.devices.length ? '需要处理' : '未连接';
});
const summaryRef = computed(() => {
  if (!connection.desktop) return '界面预览';
  if (runningRef.value) return progressRef.value.message;
  if (doctorErrorRef.value) return '环境需要处理';
  if (!environmentRef.value) return '环境待检测';
  if (!environmentRef.value.ready) return '组件待初始化';
  return readyDevicesRef.value.length ? `${readyDevicesRef.value.length} 台手机就绪` : '等待连接手机';
});

async function check(initialize = false): Promise<void> {
  if (busyRef.value || !connection.desktop) return;
  actionRef.value = initialize ? 'initialize' : 'check';
  doctorErrorRef.value = '';
  try {
    if (initialize) await connection.initialize();
    else await connection.refresh();
    doctorErrorRef.value = errorRef.value;
    checkedAtRef.value = new Date().toLocaleTimeString('zh-CN');
  } finally {
    actionRef.value = null;
  }
}

function open(): void {
  dialogRef.value?.showModal();
  void check();
}
</script>

<template>
  <button type="button" class="inline-flex min-h-8 max-w-full items-center gap-2 rounded-full border border-line bg-surface px-3 py-2 text-xs text-ink-secondary transition-colors hover:border-ink-muted hover:bg-surface-soft pointer-coarse:min-h-11" aria-haspopup="dialog" aria-controls="environment-doctor" @click="open">
    <span class="size-1.5 shrink-0 rounded-full" :class="healthyRef ? 'bg-success' : 'bg-warning'" aria-hidden="true" /><span class="truncate">{{ summaryRef }}</span><span class="hidden border-l border-line pl-2 sm:inline">环境诊断</span><ChevronRight :size="14" class="shrink-0" aria-hidden="true" />
  </button>

  <dialog id="environment-doctor" ref="doctor" class="fixed inset-0 m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-card border border-line bg-surface p-4 text-ink shadow-2xl backdrop:bg-black/70" aria-labelledby="doctor-title" aria-describedby="doctor-description">
    <div class="flex items-start justify-between gap-3">
      <div><h2 id="doctor-title" class="flex items-center gap-2 text-lg font-semibold"><Stethoscope :size="21" class="text-brand-strong" aria-hidden="true" />环境诊断</h2><p id="doctor-description" class="mt-2 text-sm leading-5 text-ink-secondary">检查本机运行环境、连接组件与手机授权。</p></div>
      <button type="button" autofocus class="grid size-8 shrink-0 place-items-center rounded-control text-ink-muted hover:bg-surface-soft hover:text-ink pointer-coarse:size-11" aria-label="关闭环境诊断" @click="dialogRef?.close()"><X :size="18" aria-hidden="true" /></button>
    </div>

    <div class="mt-4 space-y-3" :aria-busy="!!actionRef">
      <section class="rounded-control border border-line bg-canvas/40 p-3" aria-labelledby="doctor-runtime">
        <div class="flex flex-wrap items-center justify-between gap-3"><h3 id="doctor-runtime" class="flex items-center gap-2 text-sm font-medium"><Monitor :size="17" class="text-ink-muted" aria-hidden="true" />运行环境</h3><StatusPill :tone="connection.desktop ? 'success' : 'warning'">{{ connection.desktop ? '桌面客户端' : '浏览器预览' }}</StatusPill></div>
        <p class="mt-2 text-xs leading-5 text-ink-secondary">{{ connection.desktop ? '本机直接连接手机，无需后端服务。' : '当前可查看界面。检测手机与修复组件请使用安装后的桌面客户端。' }}</p>
      </section>

      <section class="rounded-control border border-line bg-canvas/40 p-3" aria-labelledby="doctor-component">
        <div class="flex flex-wrap items-center justify-between gap-3"><h3 id="doctor-component" class="flex items-center gap-2 text-sm font-medium"><ShieldCheck :size="17" class="text-ink-muted" aria-hidden="true" />Android 连接组件</h3><StatusPill :tone="environmentRef?.ready ? 'success' : 'warning'">{{ componentStatusRef }}</StatusPill></div>
        <p class="mt-2 text-xs leading-5 text-ink-secondary">{{ environmentRef ? `ADB ${environmentRef.version} · ${environmentRef.platform === 'windows' ? 'Windows' : 'macOS'}` : '检测组件是否已安装并能够正常运行。' }}</p>
        <p v-if="environmentRef && !environmentRef.ready" class="mt-2 text-xs leading-5 text-warning">点击下方「初始化组件」，从软件内安装连接组件。</p>
        <div class="mt-3"><AppButton variant="secondary" :loading="actionRef === 'initialize'" :disabled="busyRef || !connection.desktop" @click="check(true)"><Download v-if="actionRef !== 'initialize'" :size="15" aria-hidden="true" />{{ environmentRef?.ready ? '重新初始化组件' : '初始化组件' }}</AppButton></div>
      </section>

      <section class="rounded-control border border-line bg-canvas/40 p-3" aria-labelledby="doctor-phones">
        <div class="flex flex-wrap items-center justify-between gap-3"><h3 id="doctor-phones" class="flex items-center gap-2 text-sm font-medium"><Usb :size="17" class="text-ink-muted" aria-hidden="true" />手机与 USB 授权</h3><StatusPill :tone="readyDevicesRef.length ? 'success' : 'warning'">{{ phoneStatusRef }}</StatusPill></div>
        <ul v-if="environmentRef?.devices.length" class="mt-3 space-y-3" role="list"><li v-for="device in environmentRef.devices" :key="device.serial" class="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3"><div class="flex min-w-0 items-center gap-2"><Smartphone :size="18" class="shrink-0 text-ink-muted" aria-hidden="true" /><div class="min-w-0"><p class="text-sm wrap-anywhere">{{ device.model }}</p><p class="mt-1 text-xs text-ink-muted wrap-anywhere">{{ device.serial }}</p></div></div><StatusPill :tone="device.state === 'device' ? 'success' : 'warning'">{{ stateLabels[device.state] ?? device.state }}</StatusPill></li></ul>
        <p v-else class="mt-2 text-xs leading-5 text-ink-secondary">使用支持数据传输的 USB 线连接手机，解锁手机并开启 USB 调试，再点击「重新检测」。</p>
        <p v-if="environmentRef?.devices.some(device => device.state === 'unauthorized')" class="mt-3 rounded-control bg-warning-soft p-3 text-xs leading-5 text-warning">请在手机上允许这台电脑进行 USB 调试，勾选「始终允许」后重新检测。</p>
        <p v-if="environmentRef?.devices.some(device => device.state === 'offline')" class="mt-3 rounded-control bg-warning-soft p-3 text-xs leading-5 text-warning">设备离线，请解锁手机、重新插拔数据线，再重新检测。</p>
      </section>
    </div>

    <div class="mt-3 text-xs leading-5" aria-live="polite"><p v-if="doctorErrorRef" role="alert" class="rounded-control bg-danger-soft p-3 text-danger wrap-anywhere">{{ doctorErrorRef }}</p><p v-else-if="busyRef && !actionRef" class="text-warning">当前有任务正在执行，可以查看已有状态；任务结束后可重新检测。</p><p v-else-if="actionRef" class="text-brand-strong">{{ actionRef === 'check' ? '正在检测连接环境…' : '正在初始化连接组件…' }}</p><p v-else-if="checkedAtRef" class="text-ink-muted">上次检测 {{ checkedAtRef }} · {{ healthyRef ? '连接环境已就绪' : '请按上方提示完成连接' }}</p></div>
    <div class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4"><RouterLink to="/guide" class="rounded-control px-2 py-2 text-sm text-ink-secondary hover:text-ink" @click="dialogRef?.close()">查看连接指引</RouterLink><AppButton :loading="actionRef === 'check'" :disabled="busyRef || !connection.desktop" @click="check()"><RefreshCw v-if="actionRef !== 'check'" :size="15" aria-hidden="true" />重新检测</AppButton></div>
  </dialog>
</template>
