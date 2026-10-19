<script setup lang="ts">
import { computed, ref, shallowRef, useTemplateRef } from 'vue';
import { storeToRefs } from 'pinia';
import { ArrowDownToLine, Check, GitFork, Library, LockKeyhole, Plus, RefreshCw, Settings2, Trash2 } from '@lucide/vue';
import { DEFAULT_REGISTRY_URL, isOfficialRegistry, useConnectionStore, type Installed, type Registry, type RegistryInput, type Workflow } from '../useConnection';
import AppButton from './AppButton.vue';
import RegistryCard from './RegistryCard.vue';
import RegistryDialog from './RegistryDialog.vue';
import WorkflowConfigDialog from './WorkflowConfigDialog.vue';

const connection = useConnectionStore();
const { storeRef, busyRef, errorRef } = storeToRefs(connection);
const selectedKeyRef = ref(`${DEFAULT_REGISTRY_URL}@main`);
const dialogOpenRef = ref(false);
const editingRef = shallowRef<Registry | null>(null);
const dialogErrorRef = ref('');
const pendingDeleteRef = shallowRef<Registry | null>(null);
const uninstallRef = shallowRef<Installed | null>(null);
const configureRef = shallowRef<Installed | null>(null);
const confirmRef = useTemplateRef<HTMLDialogElement>('confirm');
const registriesRef = computed(() => [...storeRef.value.registries].sort((a, b) => Number(isOfficialRegistry(b)) - Number(isOfficialRegistry(a))));
const activeRef = computed(() => registriesRef.value.find(item => `${item.url}@${item.reference}` === selectedKeyRef.value) ?? registriesRef.value[0]);

function openDialog(registry: Registry | null = null): void {
  editingRef.value = registry;
  dialogErrorRef.value = '';
  dialogOpenRef.value = true;
}

async function sync(input: RegistryInput): Promise<void> {
  if (busyRef.value) return;
  dialogErrorRef.value = '';
  if (await connection.syncRegistry(input)) {
    const url = input.url.replace(/\/+$/, '').replace(/\.git$/, '');
    selectedKeyRef.value = `${url}@${input.reference}`;
    dialogOpenRef.value = false;
  } else {
    dialogErrorRef.value = errorRef.value;
  }
}

function confirmRemove(registry: Registry): void {
  if (busyRef.value || isOfficialRegistry(registry)) return;
  pendingDeleteRef.value = registry;
  uninstallRef.value = null;
  confirmRef.value?.showModal();
}

function confirmUninstall(item: Installed): void {
  if (busyRef.value) return;
  uninstallRef.value = item;
  confirmRef.value?.showModal();
}

async function remove(): Promise<void> {
  if (uninstallRef.value) {
    const item = uninstallRef.value;
    confirmRef.value?.close();
    await connection.uninstallWorkflow(item);
    uninstallRef.value = null;
    return;
  }
  const registry = pendingDeleteRef.value;
  confirmRef.value?.close();
  if (!registry || busyRef.value) return;
  if (await connection.removeRegistry(registry)) selectedKeyRef.value = `${DEFAULT_REGISTRY_URL}@main`;
}

function installedItem(registry: Registry, workflow: Workflow): Installed | undefined {
  return storeRef.value.installed.find(item => item.registryUrl === registry.url && item.reference === registry.reference && item.workflow.id === workflow.id);
}
function installedVersion(registry: Registry, workflow: Workflow): string | undefined { return installedItem(registry, workflow)?.workflow.version; }
const orphanedRef = computed(() => storeRef.value.installed.filter(item => !storeRef.value.registries.some(registry => registry.url === item.registryUrl && registry.reference === item.reference && registry.workflows.some(workflow => workflow.id === item.workflow.id))));
</script>

<template>
  <div id="store" class="space-y-7">
    <section aria-labelledby="registries-title">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2.5"><h2 id="registries-title" class="text-sm font-semibold">工作流来源</h2><span class="rounded-full bg-surface-soft px-2 py-0.5 text-xs text-ink-muted">{{ registriesRef.length }}</span></div>
        <AppButton :disabled="busyRef" @click="openDialog()"><Plus :size="16" aria-hidden="true" />添加 Registry</AppButton>
      </div>
      <ul class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="list">
        <li v-for="registry in registriesRef" :key="`${registry.url}@${registry.reference}`" class="min-w-0">
          <RegistryCard :registry="registry" :selected="activeRef === registry" :disabled="busyRef" @select="selectedKeyRef = `${registry.url}@${registry.reference}`" />
        </li>
      </ul>
      <p class="mt-3 text-xs leading-5 text-ink-muted">所有来源配置和已安装工作流保存在本机。官方来源常驻，无法移除。</p>
    </section>

    <section v-if="activeRef" id="registry-workflows" class="border-t border-line pt-6" aria-labelledby="workflows-title">
      <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0"><h2 id="workflows-title" class="flex flex-wrap items-center gap-2 text-sm font-semibold"><Library :size="18" class="shrink-0 text-brand-strong" aria-hidden="true" /><span class="wrap-anywhere">{{ activeRef.name }}</span><span class="shrink-0 text-xs font-normal text-ink-muted">{{ activeRef.workflows.length }} 个工作流</span></h2><p class="mt-2 text-xs leading-5 text-ink-muted">{{ activeRef.commit === 'bundled' ? '随软件附带 · 同步来源可获取新版' : `已同步提交 ${activeRef.commit.slice(0, 8)}` }}</p></div>
        <div class="flex flex-wrap items-center gap-1"><AppButton variant="secondary" :disabled="busyRef" @click="openDialog(activeRef)"><RefreshCw :size="15" aria-hidden="true" />同步来源</AppButton><AppButton v-if="!isOfficialRegistry(activeRef)" variant="ghost" :disabled="busyRef" @click="confirmRemove(activeRef)"><Trash2 :size="15" aria-hidden="true" />移除来源</AppButton><span v-else class="inline-flex items-center gap-1.5 px-3 text-xs text-ink-muted"><LockKeyhole :size="13" aria-hidden="true" />官方来源</span></div>
      </div>
      <ul v-if="activeRef.workflows.length" class="grid gap-3 lg:grid-cols-2" role="list">
        <li v-for="workflow in activeRef.workflows" :key="workflow.id" class="flex min-w-0 flex-col rounded-card border border-line bg-surface p-4">
          <div class="flex items-start justify-between gap-3"><h3 class="text-sm leading-5 font-semibold wrap-anywhere">{{ workflow.name }}</h3><span class="shrink-0 rounded-full bg-surface-soft px-2.5 py-1 text-xs text-ink-muted">v{{ workflow.version }}</span></div>
          <p class="mt-3 text-xs leading-5 text-ink-secondary">{{ workflow.description }}</p>
          <p v-if="workflow.inputSchema && installedItem(activeRef, workflow)" class="mt-2 text-xs" :class="installedItem(activeRef, workflow)?.input ? 'text-success' : 'text-warning'">{{ installedItem(activeRef, workflow)?.input ? '已配置消息与接收会话' : '运行前请先配置' }}</p><p class="mt-3 mb-4 text-xs text-ink-muted wrap-anywhere">{{ workflow.steps.length }} 个步骤 · {{ workflow.package }}</p>
          <div class="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4"><span class="inline-flex items-center gap-1.5 text-xs" :class="installedVersion(activeRef, workflow) ? 'text-success' : 'text-ink-muted'"><Check v-if="installedVersion(activeRef, workflow)" :size="13" aria-hidden="true" />{{ installedVersion(activeRef, workflow) === workflow.version ? '已安装' : installedVersion(activeRef, workflow) ? `已安装 v${installedVersion(activeRef, workflow)}` : '尚未安装' }}</span><div class="flex flex-wrap items-center gap-1"><AppButton v-if="installedItem(activeRef, workflow)" variant="secondary" :disabled="busyRef" :aria-label="`配置 ${workflow.name}`" @click="configureRef = installedItem(activeRef!, workflow) ?? null"><Settings2 :size="13" />配置</AppButton><AppButton v-if="installedItem(activeRef, workflow)" variant="ghost" :disabled="busyRef" :aria-label="`卸载 ${workflow.name}`" @click="confirmUninstall(installedItem(activeRef!, workflow)!)"><Trash2 :size="14" /></AppButton><AppButton v-if="installedVersion(activeRef, workflow) !== workflow.version" variant="primary" :disabled="busyRef" @click="connection.installWorkflow(activeRef, workflow)"><ArrowDownToLine :size="15" aria-hidden="true" />{{ installedVersion(activeRef, workflow) ? '更新工作流' : '安装工作流' }}</AppButton></div></div>
        </li>
      </ul>
      <div v-else class="rounded-card border border-dashed border-line bg-surface px-4 py-12 text-center"><GitFork :size="28" class="mx-auto text-ink-muted" aria-hidden="true" /><p class="mt-3 text-sm text-ink-secondary">这个来源还没有发布工作流</p><p class="mt-2 text-xs text-ink-muted">作者发布后，点击「同步来源」即可获取。</p></div>
    </section>

    <section v-if="orphanedRef.length" class="border-t border-line pt-5" aria-labelledby="installed-title">
      <h2 id="installed-title" class="mb-3 text-sm font-semibold">其他已安装 · {{ orphanedRef.length }}</h2>
      <ul class="grid gap-3 lg:grid-cols-2"><li v-for="item in orphanedRef" :key="item.key" class="rounded-card border border-line bg-surface p-3">
        <div class="flex items-start justify-between gap-2"><div class="min-w-0"><h3 class="text-sm font-medium wrap-anywhere">{{ item.workflow.name }}</h3><p class="mt-1 text-xs text-ink-muted">v{{ item.workflow.version }} · {{ item.commit === 'bundled' ? '随软件附带' : item.commit.slice(0, 8) }}</p><p v-if="item.workflow.inputSchema" class="mt-1 text-xs" :class="item.input ? 'text-success' : 'text-warning'">{{ item.input ? '已保存消息与接收配置' : '运行前需要配置消息与接收会话' }}</p></div><div class="flex shrink-0 gap-1"><AppButton variant="secondary" :disabled="busyRef" @click="configureRef = item"><Settings2 :size="13" />配置</AppButton><AppButton variant="ghost" :disabled="busyRef" :aria-label="`卸载 ${item.workflow.name}`" @click="confirmUninstall(item)"><Trash2 :size="14" /></AppButton></div></div>
      </li></ul>
    </section>
    <WorkflowConfigDialog :item="configureRef" @close="configureRef = null" />
    <RegistryDialog :open="dialogOpenRef" :registry="editingRef" :busy="busyRef" :error="dialogErrorRef" @submit="sync" @close="dialogOpenRef = false" />
    <dialog ref="confirm" class="fixed inset-0 m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-card border border-line bg-surface p-4 text-ink shadow-2xl backdrop:bg-black/70" aria-labelledby="remove-registry-title" aria-describedby="remove-registry-description">
      <h2 id="remove-registry-title" class="text-lg font-semibold">{{ uninstallRef ? '卸载这个工作流？' : '移除这个 Registry？' }}</h2><p class="mt-3 text-sm text-ink wrap-anywhere">{{ uninstallRef?.workflow.name ?? pendingDeleteRef?.name }}</p><p id="remove-registry-description" class="mt-2 text-sm leading-5 text-ink-secondary">{{ uninstallRef ? '卸载后不再运行此工作流，相关定时任务会暂停。历史记录保留，可随时从来源重新安装。' : '移除后不再显示此来源。已安装的工作流与运行记录保留，可重新添加此仓库。' }}</p><div class="mt-4 flex justify-end gap-3"><AppButton variant="secondary" autofocus @click="confirmRef?.close()">取消</AppButton><button type="button" :disabled="busyRef" class="min-h-8 rounded-control bg-danger px-4 text-sm font-medium text-canvas disabled:opacity-45 pointer-coarse:min-h-11" @click="remove">{{ uninstallRef ? '确认卸载' : '确认移除' }}</button></div>
    </dialog>
  </div>
</template>
