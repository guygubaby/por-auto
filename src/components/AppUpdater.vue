<script setup lang="ts">
import { computed, useTemplateRef } from 'vue';
import { ArrowDownToLine, RefreshCw, X } from '@lucide/vue';
import { useAppUpdater } from '../useAppUpdater';
import AppButton from './AppButton.vue';

defineProps<{ workflowBusy: boolean }>();
const { statusRef, errorRef, busyRef, installingRef, percentRef, action } = useAppUpdater();
const dialogRef = useTemplateRef<HTMLDialogElement>('dialog');
const labels = {
  idle: '尚未检查', checking: '正在检查更新…', 'up-to-date': '已是最新版本',
  available: '发现新版本', downloading: '正在下载更新…', installing: '正在校验并安装…', error: '更新未完成',
};
const downloadedRef = computed(() => `${(statusRef.value.downloaded / 1048576).toFixed(1)} MB`);
const statusTextRef = computed(() => labels[statusRef.value.phase]);

function open(): void {
  dialogRef.value?.showModal();
  if (statusRef.value.phase === 'idle') void action('check_for_updates');
}
</script>

<template>
  <button type="button" class="inline-flex min-h-8 shrink-0 items-center gap-2 rounded-control px-2 text-xs text-ink-muted hover:bg-surface-soft hover:text-ink pointer-coarse:min-h-11" aria-haspopup="dialog" aria-controls="app-updater" :aria-label="`软件更新，当前版本 ${statusRef.currentVersion}，${statusTextRef}`" @click="open">
    <ArrowDownToLine :size="14" aria-hidden="true" /><span>v{{ statusRef.currentVersion }}</span><span v-if="statusRef.version" class="size-1.5 rounded-full bg-success" aria-label="有新版本" />
  </button>
  <dialog id="app-updater" ref="dialog" class="fixed inset-0 m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-md overflow-auto rounded-card border border-line bg-surface p-4 text-ink shadow-2xl backdrop:bg-black/70" aria-labelledby="update-title">
    <div class="flex items-start justify-between gap-3"><div><h2 id="update-title" class="text-lg font-semibold">软件更新</h2><p class="mt-1 text-xs text-ink-muted">当前版本 v{{ statusRef.currentVersion }} · GitHub Release</p></div><button type="button" autofocus class="grid size-8 shrink-0 place-items-center rounded-control text-ink-muted hover:bg-surface-soft pointer-coarse:size-11" aria-label="关闭软件更新" @click="dialogRef?.close()"><X :size="16" aria-hidden="true" /></button></div>
    <div class="mt-4 rounded-control border border-line bg-canvas/40 p-3" aria-live="polite">
      <p class="text-sm font-medium">{{ statusTextRef }}<span v-if="statusRef.version" class="ml-2 text-success">v{{ statusRef.version }}</span></p>
      <p v-if="statusRef.checkedAt" class="mt-1 text-xs text-ink-muted">上次检查 {{ new Date(statusRef.checkedAt).toLocaleString('zh-CN') }}</p>
      <p v-if="statusRef.notes" class="mt-3 max-h-48 overflow-auto whitespace-pre-wrap text-xs leading-5 text-ink-secondary">{{ statusRef.notes }}</p>
      <div v-if="installingRef" class="mt-3">
        <progress :value="percentRef ?? undefined" max="100" class="h-2 w-full accent-brand" aria-label="更新下载进度" />
        <p class="mt-2 text-xs tabular-nums text-ink-muted">{{ percentRef === null ? downloadedRef : `${percentRef}% · ${downloadedRef}` }}</p>
      </div>
    </div>
    <label class="mt-3 flex min-h-9 cursor-pointer items-center gap-2 text-xs text-ink-secondary pointer-coarse:min-h-11"><input type="checkbox" class="size-4 accent-brand" :checked="statusRef.autoCheck" :disabled="busyRef" @change="action('set_auto_update_check', { enabled: !statusRef.autoCheck })" />自动检查更新</label>
    <p class="text-xs leading-5 text-ink-muted">启动时及每 6 小时检查一次。发现新版本后由你选择安装，安装包会校验签名；配置、工作流和日志保留在本机。</p>
    <p v-if="workflowBusy" class="mt-3 text-xs leading-5 text-warning">请等待当前工作流结束后安装更新。</p>
    <p v-if="errorRef || statusRef.error" role="alert" class="mt-3 text-xs leading-5 text-danger wrap-anywhere">{{ errorRef || statusRef.error }}</p>
    <div class="mt-4 flex flex-wrap justify-end gap-2 border-t border-line pt-3">
      <AppButton variant="secondary" :disabled="busyRef" @click="action('check_for_updates')"><RefreshCw :size="14" :class="{ 'animate-spin': statusRef.phase === 'checking' }" aria-hidden="true" />检查更新</AppButton>
      <AppButton v-if="statusRef.version" :disabled="busyRef || workflowBusy" @click="action('install_app_update')"><ArrowDownToLine :size="14" aria-hidden="true" />下载更新并重启</AppButton>
    </div>
    <p v-if="statusRef.version" class="mt-3 text-xs leading-5 text-ink-muted">更新期间阻止新的手机操作，完成后自动重启客户端。</p>
  </dialog>
</template>
