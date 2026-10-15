<script setup lang="ts">
import { computed, ref } from 'vue';
import { ArrowDownToLine, Check, GitBranch, GitFork, Library, LockKeyhole, RefreshCw } from '@lucide/vue';
import type { Registry, RegistryInput, Store, Workflow } from '../useConnection';
import AppButton from './AppButton.vue';
import StatusPill from './StatusPill.vue';

const props = defineProps<{ store: Store; busy: boolean }>();
const emit = defineEmits<{ sync: [input: RegistryInput]; install: [registry: Registry, workflow: Workflow] }>();
const urlRef = ref('https://github.com/guygubaby/por-auto');
const referenceRef = ref('main');
const tokenRef = ref('');
const activeRef = computed(() => props.store.registries.find(item => item.url === urlRef.value.replace(/\.git$/, '').replace(/\/$/, '') && item.reference === referenceRef.value));

function submit(): void {
  const input = { url: urlRef.value.trim(), reference: referenceRef.value.trim(), token: tokenRef.value.trim() };
  tokenRef.value = '';
  emit('sync', input);
}

function installedVersion(registry: Registry, workflow: Workflow): string | undefined {
  return props.store.installed.find(item => item.registryUrl === registry.url && item.reference === registry.reference && item.workflow.id === workflow.id)?.workflow.version;
}
</script>

<template>
  <section id="store" class="scroll-mt-6 rounded-card border border-line bg-surface p-5">
    <div class="flex flex-wrap items-center justify-between gap-3"><div><h2 class="flex items-center gap-2 text-sm font-semibold"><Library :size="18" class="text-brand-strong" aria-hidden="true" />工作流商店</h2><p class="mt-2 text-xs leading-6 text-ink-muted">添加 GitHub 仓库，获取新工作流。安装后保存在本机，可以离线运行。</p></div><StatusPill>{{ store.installed.length }} 个已安装</StatusPill></div>

    <form class="mt-5 space-y-4 rounded-control border border-line bg-canvas/40 p-4" @submit.prevent="submit">
      <div class="grid gap-4 sm:grid-cols-3">
        <div class="sm:col-span-2"><label for="registry-url" class="mb-2 flex items-center gap-2 text-xs text-ink-secondary"><GitFork :size="14" aria-hidden="true" />GitHub 仓库地址</label><input id="registry-url" v-model="urlRef" type="url" required :disabled="busy" class="min-h-10 w-full rounded-control border border-line bg-surface-soft px-3 text-sm" placeholder="https://github.com/作者/仓库" /></div>
        <div><label for="registry-ref" class="mb-2 flex items-center gap-2 text-xs text-ink-secondary"><GitBranch :size="14" aria-hidden="true" />分支或标签</label><input id="registry-ref" v-model="referenceRef" required maxlength="200" :disabled="busy" class="min-h-10 w-full rounded-control border border-line bg-surface-soft px-3 text-sm" /></div>
      </div>
      <div><label for="registry-token" class="mb-2 flex items-center gap-2 text-xs text-ink-secondary"><LockKeyhole :size="14" aria-hidden="true" />GitHub 访问令牌（私有仓库需要）</label><input id="registry-token" v-model="tokenRef" type="password" autocomplete="off" maxlength="500" :disabled="busy" class="min-h-10 w-full rounded-control border border-line bg-surface-soft px-3 text-sm" aria-describedby="token-help" placeholder="公开仓库可留空" /><p id="token-help" class="mt-2 text-xs leading-5 text-ink-muted">使用可访问此仓库、具有 Contents 只读权限的令牌。仅用于本次同步，提交后清空。</p></div>
      <div class="flex flex-wrap items-center justify-between gap-3"><p class="text-xs text-ink-muted">读取固定目录：workflows/registry.json</p><button type="submit" :disabled="busy" class="inline-flex min-h-10 items-center gap-2 rounded-control bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-45"><RefreshCw :size="15" :class="{ 'animate-spin': busy }" aria-hidden="true" />{{ busy ? '请稍候…' : '添加 / 刷新仓库' }}</button></div>
    </form>

    <div v-if="store.registries.length > 1" class="mt-4 flex flex-wrap gap-2"><AppButton v-for="registry in store.registries" :key="`${registry.url}@${registry.reference}`" variant="secondary" :disabled="busy" @click="urlRef = registry.url; referenceRef = registry.reference">{{ registry.name }} / {{ registry.reference }}</AppButton></div>

    <div v-if="activeRef" class="mt-5">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2"><p class="text-xs font-medium text-ink-secondary">{{ activeRef.name }}</p><span class="text-xs text-ink-muted">{{ activeRef.commit === 'bundled' ? '随软件附带 · 联网刷新可获取新版' : `已同步提交 ${activeRef.commit.slice(0, 8)}` }}</span></div>
      <ul class="space-y-3" role="list">
        <li v-for="workflow in activeRef.workflows" :key="workflow.id" class="rounded-control border border-line bg-surface-raised p-4">
          <div class="flex flex-wrap items-start justify-between gap-4"><div class="min-w-0 flex-1"><h3 class="text-sm font-semibold">{{ workflow.name }} <span class="ml-2 text-xs font-normal text-ink-muted">{{ workflow.version }}</span></h3><p class="mt-2 text-xs leading-6 text-ink-secondary">{{ workflow.description }}</p><p class="mt-2 text-xs text-ink-muted">{{ workflow.steps.length }} 个步骤 · {{ workflow.package }}</p></div><AppButton :variant="installedVersion(activeRef, workflow) === workflow.version ? 'secondary' : 'primary'" :disabled="busy" @click="$emit('install', activeRef, workflow)"><Check v-if="installedVersion(activeRef, workflow) === workflow.version" :size="15" aria-hidden="true" /><ArrowDownToLine v-else :size="15" aria-hidden="true" />{{ installedVersion(activeRef, workflow) === workflow.version ? '重新安装' : installedVersion(activeRef, workflow) ? '更新工作流' : '安装工作流' }}</AppButton></div>
        </li>
      </ul>
      <p v-if="!activeRef.workflows.length" class="py-4 text-sm text-ink-muted">这个仓库还没有发布工作流。</p>
    </div>
    <p v-else class="mt-5 text-xs leading-6 text-ink-muted">添加后会列出这个仓库中的工作流；已安装的其他工作流会继续保留。</p>
  </section>
</template>
