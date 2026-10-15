<script setup lang="ts">
import { Cable, CircleHelp, FolderCheck, History, Library, Monitor, Smartphone } from '@lucide/vue';
import { onMounted, onBeforeUnmount } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { storeToRefs } from 'pinia';
import { useConnectionStore } from './useConnection';
import StatusPill from './components/StatusPill.vue';
const route = useRoute();
const connection = useConnectionStore();
const { errorRef, noticeRef, runningRef, progressRef } = storeToRefs(connection);
const desktop = connection.desktop;
const navigation = [
  { to: '/', label: '设备与运行', icon: Cable },
  { to: '/results', label: '运行结果', icon: FolderCheck },
  { to: '/history', label: '运行记录', icon: History },
  { to: '/store', label: '工作流商店', icon: Library },
  { to: '/guide', label: '使用指引', icon: CircleHelp },
];
onMounted(connection.initializeApp);
onBeforeUnmount(connection.dispose);
function focusContent(): void { document.getElementById('main-content')?.focus(); }
</script>

<template>
  <div class="flex min-h-full text-ink md:h-full md:overflow-hidden">
    <a href="#main-content" class="fixed top-3 left-3 z-50 -translate-y-24 rounded-control bg-brand px-4 py-3 text-sm text-white focus:translate-y-0" @click.prevent="focusContent">跳到主要内容</a>
    <aside class="hidden w-52 shrink-0 flex-col border-r border-line/70 bg-sidebar p-3 md:flex">
      <div class="flex items-center gap-3 px-2 py-4"><div class="grid size-10 shrink-0 place-items-center rounded-xl bg-brand"><Smartphone :size="21" aria-hidden="true" /></div><div><p class="text-sm font-semibold">Por Auto</p><p class="mt-1 text-xs text-ink-muted">Android 工作流</p></div></div>
      <nav class="mt-6 space-y-2" aria-label="工作台">
        <RouterLink v-for="item in navigation" :key="item.to" :to="item.to" class="flex min-h-11 items-center gap-3 rounded-control px-3 text-sm text-ink-secondary hover:bg-white/5 [&.router-link-exact-active]:bg-brand-soft [&.router-link-exact-active]:text-brand-strong"><component :is="item.icon" :size="17" aria-hidden="true" />{{ item.label }}</RouterLink>
      </nav>
      <div class="mt-auto rounded-control border border-line bg-surface px-3 py-4"><p class="flex items-center gap-2 text-xs text-ink-secondary"><Monitor :size="14" aria-hidden="true" />本机运行</p><p class="mt-2 text-xs leading-6 text-ink-muted">手机通过 USB 连接<br />运行结果保存在本机</p></div>
      <p class="px-3 pt-4 pb-1 text-xs text-ink-muted">流程试用版 · 0.1.0</p>
    </aside>
    <div class="flex min-w-0 flex-1 flex-col">
      <header class="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-line/70 px-5 sm:px-7"><p class="flex items-center gap-2 text-sm text-ink-secondary"><Smartphone :size="17" class="text-brand-strong" aria-hidden="true" />Por Auto</p><StatusPill :tone="runningRef ? 'warning' : 'neutral'">{{ runningRef ? progressRef.message : 'USB 连接 · Android' }}</StatusPill></header>
      <nav class="flex flex-wrap gap-2 border-b border-line px-5 py-3 md:hidden" aria-label="页面"><RouterLink v-for="item in navigation" :key="item.to" :to="item.to" class="rounded-control px-3 py-2 text-xs text-ink-secondary [&.router-link-exact-active]:bg-brand-soft [&.router-link-exact-active]:text-brand-strong">{{ item.label }}</RouterLink></nav>
      <main id="main-content" tabindex="-1" class="min-h-0 flex-1 overflow-auto px-5 py-7 sm:px-7">
        <div class="mx-auto max-w-5xl">
          <div class="mb-5"><h1 class="text-2xl font-semibold tracking-tight">{{ route.meta.title }}</h1><p class="mt-2 text-sm leading-6 text-ink-secondary">{{ route.meta.description }}</p></div>
          <div v-if="!desktop" class="mb-5 rounded-control border border-warning/20 bg-warning-soft px-4 py-3 text-sm text-warning">界面预览 · 手机操作请使用安装后的桌面客户端</div>
          <div class="mb-5 text-sm" aria-live="polite" aria-atomic="true"><p v-if="errorRef" class="break-words text-danger">{{ errorRef }}</p><p v-else-if="noticeRef" class="text-ink-secondary">{{ noticeRef }}</p></div>
          <RouterView />
        </div>
      </main>
    </div>
  </div>
</template>
