<script setup lang="ts">
import { ref } from 'vue';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Download, ExternalLink, Smartphone } from '@lucide/vue';
import AppButton from './AppButton.vue';

const desktop = isTauri();
const actionRef = ref<'launcher' | 'workflows' | 'runtime' | 'input_component' | null>(null);
const noticeRef = ref('');
const errorRef = ref('');

async function download(kind: 'launcher' | 'workflows' | 'runtime' | 'input_component') {
  if (!desktop || actionRef.value) return;
  actionRef.value = kind;
  noticeRef.value = '';
  errorRef.value = '';
  try {
    if (kind === 'runtime') {
      await invoke('open_mobile_runtime');
      noticeRef.value = '已打开 AutoJs6 官方下载页面。';
    } else {
      const path = await invoke<string | null>('export_mobile_scripts', { kind });
      noticeRef.value = path ? `已保存：${path}` : '已取消保存。';
    }
  } catch (error) {
    errorRef.value = String(error);
  } finally {
    actionRef.value = null;
  }
}
</script>

<template>
  <section class="rounded-card border border-line bg-surface p-4">
    <div class="flex items-center gap-2"><Smartphone :size="16" class="text-brand" aria-hidden="true" /><h2 class="text-sm font-semibold">手机独立运行 · 预览</h2></div>
    <p class="mt-2 text-xs leading-5 text-ink-secondary">把启动脚本导入手机后，就能在手机选择、配置和运行工作流。之后新增或更新脚本，只需在手机检查更新。</p>
    <ol class="mt-4 grid gap-4 text-xs leading-5 text-ink-secondary sm:grid-cols-3" role="list">
      <li class="flex flex-col items-start gap-2"><h3 class="font-medium text-ink">1. 安装运行环境</h3><p class="flex-1">从官方页面下载 AutoJs6 安装包，传到安卓手机并安装。</p><AppButton variant="secondary" :loading="actionRef === 'runtime'" :disabled="!desktop || actionRef !== null" @click="download('runtime')"><ExternalLink :size="14" aria-hidden="true" />官方下载</AppButton></li>
      <li class="flex flex-col items-start gap-2"><h3 class="font-medium text-ink">2. 导入启动脚本</h3><p class="flex-1">保存后传到手机，在 AutoJs6 中导入并运行这个脚本。</p><AppButton variant="secondary" :loading="actionRef === 'launcher'" :disabled="!desktop || actionRef !== null" @click="download('launcher')"><Download :size="14" aria-hidden="true" />保存启动脚本</AppButton></li>
      <li class="flex flex-col items-start gap-2"><h3 class="font-medium text-ink">3. 安装与更新工作流</h3><p class="flex-1">在手机检查更新并安装「微信手机工作流」。网络不便时，也可导入离线包。</p><AppButton variant="secondary" :loading="actionRef === 'workflows'" :disabled="!desktop || actionRef !== null" @click="download('workflows')"><Download :size="14" aria-hidden="true" />保存离线工作流</AppButton></li>
    </ol>
    <div class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-control bg-surface-soft p-3">
      <p class="text-xs leading-5 text-ink-secondary">微信发送工作流需要输入组件，用于原生输入与核对文字。保存后传到手机安装；企业微信无需安装。</p>
      <AppButton variant="secondary" :loading="actionRef === 'input_component'" :disabled="!desktop || actionRef !== null" @click="download('input_component')"><Download :size="14" aria-hidden="true" />保存输入组件</AppButton>
    </div>
    <p v-if="!desktop" class="mt-3 text-xs text-ink-muted">请在桌面客户端中保存手机脚本。</p>
    <p class="mt-3 break-all text-xs leading-5 text-success" role="status">{{ noticeRef }}</p>
    <p v-if="errorRef" class="mt-2 break-words text-xs leading-5 text-danger" role="alert">{{ errorRef }}</p>
    <p class="mt-3 border-t border-line pt-3 text-xs leading-5 text-ink-muted">首次运行请开启 AutoJs6 无障碍服务。微信需要截图授权、手机可访问的图像接口及输入组件；企业微信使用原生控件。发送类默认预演。手机定时任务在商店「更多 → 定时任务」中管理；保持手机解锁并开启定时执行。</p>
  </section>
</template>
