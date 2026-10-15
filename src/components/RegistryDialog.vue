<script setup lang="ts">
import { ref, useTemplateRef, watch } from 'vue';
import { GitBranch, GitFork, LockKeyhole, RefreshCw, X } from '@lucide/vue';
import type { Registry, RegistryInput } from '../useConnection';
import AppButton from './AppButton.vue';

const props = defineProps<{ open: boolean; registry: Registry | null; busy: boolean; error: string }>();
const emit = defineEmits<{ submit: [input: RegistryInput]; close: [] }>();
const dialogRef = useTemplateRef<HTMLDialogElement>('dialog');
const urlRef = ref('');
const referenceRef = ref('main');
const tokenRef = ref('');

watch(() => props.open, open => {
  if (open) {
    urlRef.value = props.registry?.url ?? '';
    referenceRef.value = props.registry?.reference ?? 'main';
    tokenRef.value = '';
    dialogRef.value?.showModal();
  } else {
    dialogRef.value?.close();
    tokenRef.value = '';
  }
});

function submit(): void {
  if (props.busy) return;
  const input = { url: urlRef.value.trim(), reference: referenceRef.value.trim(), token: tokenRef.value.trim() };
  tokenRef.value = '';
  emit('submit', input);
}

function close(): void {
  tokenRef.value = '';
  emit('close');
}
</script>

<template>
  <dialog ref="dialog" class="fixed inset-0 m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-card border border-line bg-surface p-4 text-ink shadow-2xl backdrop:bg-black/70" aria-labelledby="registry-dialog-title" aria-describedby="registry-dialog-description" @close="close" @cancel="close">
    <div class="flex items-start justify-between gap-3">
      <div><h2 id="registry-dialog-title" class="text-lg font-semibold">{{ registry ? '同步 Registry' : '添加 Registry' }}</h2><p id="registry-dialog-description" class="mt-2 text-sm leading-5 text-ink-secondary">{{ registry ? '获取此来源的最新工作流与版本。' : '连接 GitHub 仓库，将工作流添加到你的商店。' }}</p></div>
      <button type="button" class="grid size-8 shrink-0 place-items-center rounded-control text-ink-muted hover:bg-surface-soft hover:text-ink pointer-coarse:size-11" aria-label="关闭 Registry 弹窗" @click="close"><X :size="18" aria-hidden="true" /></button>
    </div>
    <form class="mt-4 space-y-4" :aria-busy="busy" @submit.prevent="submit">
      <div><label for="registry-url" class="mb-2 flex items-center gap-2 text-xs text-ink-secondary"><GitFork :size="14" aria-hidden="true" />GitHub 仓库地址</label><input id="registry-url" v-model="urlRef" type="url" required autofocus :readonly="!!registry" :disabled="busy" class="min-h-9 w-full rounded-control border border-line bg-surface-soft px-3 text-sm read-only:text-ink-muted pointer-coarse:min-h-11" placeholder="https://github.com/作者/仓库" /></div>
      <div><label for="registry-ref" class="mb-2 flex items-center gap-2 text-xs text-ink-secondary"><GitBranch :size="14" aria-hidden="true" />分支或标签</label><input id="registry-ref" v-model="referenceRef" required maxlength="200" :readonly="!!registry" :disabled="busy" class="min-h-9 w-full rounded-control border border-line bg-surface-soft px-3 text-sm read-only:text-ink-muted pointer-coarse:min-h-11" /></div>
      <div><label for="registry-token" class="mb-2 flex items-center gap-2 text-xs text-ink-secondary"><LockKeyhole :size="14" aria-hidden="true" />GitHub 访问令牌 <span class="text-ink-muted">私有仓库需要</span></label><input id="registry-token" v-model="tokenRef" type="password" autocomplete="off" maxlength="500" :disabled="busy" class="min-h-9 w-full rounded-control border border-line bg-surface-soft px-3 text-sm pointer-coarse:min-h-11" aria-describedby="registry-token-help" placeholder="公开仓库可留空" /><p id="registry-token-help" class="mt-2 text-xs leading-5 text-ink-muted">仅用于本次同步，提交或关闭后清空，不保存在本机。令牌需要此仓库的 Contents 只读权限。</p></div>
      <p v-if="error" role="alert" class="rounded-control bg-danger-soft px-3 py-2 text-xs leading-5 text-danger wrap-anywhere">{{ error }}</p>
      <div class="flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4"><AppButton variant="secondary" @click="close">取消</AppButton><button type="submit" :disabled="busy" class="inline-flex min-h-8 items-center gap-2 rounded-control bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong disabled:cursor-wait disabled:opacity-45 pointer-coarse:min-h-11"><RefreshCw :size="15" :class="{ 'animate-spin': busy }" aria-hidden="true" />{{ busy ? '正在同步…' : registry ? '同步工作流' : '添加并同步' }}</button></div>
    </form>
  </dialog>
</template>
