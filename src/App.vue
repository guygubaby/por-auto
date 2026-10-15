<script setup lang="ts">
import { Cable, CircleHelp, FolderCheck, Library, Monitor, Smartphone } from '@lucide/vue';
import ConnectionPanel from './components/ConnectionPanel.vue';
import StatusPill from './components/StatusPill.vue';
</script>

<template>
  <div class="flex min-h-full text-ink md:h-full md:overflow-hidden">
    <a href="#main-content" class="fixed top-3 left-3 z-50 -translate-y-24 rounded-control bg-brand px-4 py-3 text-sm text-white focus:translate-y-0">跳到主要内容</a>
    <aside class="hidden w-52 shrink-0 flex-col border-r border-line/70 bg-sidebar p-3 md:flex">
      <div class="flex items-center gap-3 px-2 py-4"><div class="grid size-10 shrink-0 place-items-center rounded-xl bg-brand"><Smartphone :size="21" aria-hidden="true" /></div><div><p class="text-sm font-semibold">微信连接助手</p><p class="mt-1 text-xs text-ink-muted">Android 桌面工具</p></div></div>
      <nav class="mt-6 space-y-2" aria-label="工作台">
        <a href="#connect" class="flex min-h-11 items-center gap-3 rounded-control bg-brand-soft px-3 text-sm text-brand-strong"><Cable :size="17" aria-hidden="true" />连接与读取</a>
        <a href="#result" class="flex min-h-11 items-center gap-3 rounded-control px-3 text-sm text-ink-secondary hover:bg-white/5"><FolderCheck :size="17" aria-hidden="true" />读取结果</a>
        <a href="#store" class="flex min-h-11 items-center gap-3 rounded-control px-3 text-sm text-ink-secondary hover:bg-white/5"><Library :size="17" aria-hidden="true" />工作流商店</a>
        <a href="#guide" class="flex min-h-11 items-center gap-3 rounded-control px-3 text-sm text-ink-secondary hover:bg-white/5"><CircleHelp :size="17" aria-hidden="true" />连接指引</a>
      </nav>
      <div class="mt-auto rounded-control border border-line bg-surface px-3 py-4"><p class="flex items-center gap-2 text-xs text-ink-secondary"><Monitor :size="14" aria-hidden="true" />本机运行</p><p class="mt-2 text-xs leading-6 text-ink-muted">手机通过 USB 连接<br />读取结果保存在本机</p></div>
      <p class="px-3 pt-4 pb-1 text-xs text-ink-muted">流程试用版 · 0.1.0</p>
    </aside>
    <div class="flex min-w-0 flex-1 flex-col">
      <header class="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-line/70 px-5 sm:px-7"><p class="flex items-center gap-2 text-sm text-ink-secondary"><Smartphone :size="17" class="text-brand-strong" aria-hidden="true" />微信连接助手</p><StatusPill>USB 连接 · Android</StatusPill></header>
      <main id="main-content" tabindex="-1" class="min-h-0 flex-1 overflow-auto px-5 py-7 sm:px-7">
        <div class="mx-auto max-w-5xl">
          <div class="mb-5"><h1 class="text-2xl font-semibold tracking-tight">连接手机，查看微信昵称</h1><p class="mt-2 text-sm leading-6 text-ink-secondary">用一次简单操作，确认电脑与手机之间的自动化流程。</p></div>
          <ConnectionPanel />
        </div>
      </main>
    </div>
  </div>
</template>
