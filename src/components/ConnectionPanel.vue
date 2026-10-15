<script setup lang="ts">
import { ArrowRight, Cable, Check, CircleHelp, Download, Play, RefreshCw, ShieldCheck, Smartphone, Usb } from '@lucide/vue';
import { useConnection } from '../useConnection';
import AppButton from './AppButton.vue';
import StatusPill from './StatusPill.vue';
import ResultPanel from './ResultPanel.vue';
import WorkflowStore from './WorkflowStore.vue';

const { desktop, environmentRef, selectedRef, busyRef, readingRef, errorRef, noticeRef, progressRef, resultRef, readyDevicesRef, selectedDeviceRef, storeRef, workflowKeyRef, selectedWorkflowRef, syncRegistry, installWorkflow, refresh, initialize, readNickname, openResults } = useConnection();
const stateLabels: Record<string, string> = { device: '可以使用', unauthorized: '等待手机授权', offline: '设备离线', recovery: '恢复模式', sideload: '刷机模式', no: '连接权限不足' };
</script>

<template>
  <div class="space-y-5">
    <div v-if="!desktop" class="rounded-control border border-warning/20 bg-warning-soft px-4 py-3 text-sm text-warning">界面预览 · 手机操作请使用安装后的桌面客户端</div>
    <div class="sticky top-0 z-10 flex min-h-6 items-center rounded-control bg-canvas py-2 text-sm" aria-live="polite" aria-atomic="true">
      <p v-if="errorRef" class="break-words text-danger">{{ errorRef }}</p>
      <p v-else-if="noticeRef" class="text-success">{{ noticeRef }}</p>
      <p v-else class="text-ink-muted">首次使用先准备连接组件，再用 USB 数据线连接 Android 手机。</p>
    </div>

    <section id="connect" class="scroll-mt-6 rounded-card border border-line bg-surface p-5">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <div class="grid size-10 place-items-center rounded-control bg-brand-soft text-brand-strong"><ShieldCheck :size="20" aria-hidden="true" /></div>
          <div><h2 class="text-sm font-semibold">连接环境</h2><p class="mt-1 text-xs text-ink-muted">组件随软件附带，无需额外安装 Python</p></div>
        </div>
        <StatusPill :tone="environmentRef?.ready ? 'success' : 'warning'">{{ environmentRef?.ready ? '组件已就绪' : '待初始化' }}</StatusPill>
      </div>
      <div class="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-control border border-line bg-canvas/50 px-4 py-3">
        <div class="flex items-center gap-3 text-sm"><Usb :size="18" class="text-ink-muted" aria-hidden="true" /><span>Android 连接组件</span><span v-if="environmentRef" class="text-xs text-ink-muted">{{ environmentRef.version }}</span></div>
        <AppButton :variant="environmentRef?.ready ? 'secondary' : 'primary'" :loading="busyRef && !readingRef" :disabled="readingRef" @click="initialize"><Check v-if="environmentRef?.ready" :size="15" aria-hidden="true" /><Download v-else :size="15" aria-hidden="true" />{{ environmentRef?.ready ? '重新初始化' : '初始化连接组件' }}</AppButton>
      </div>
    </section>

    <section class="rounded-card border border-line bg-surface p-5">
      <div class="flex items-center justify-between gap-3">
        <div><h2 class="text-sm font-semibold">连接的手机</h2><p class="mt-1 text-xs text-ink-muted">先解锁手机，并在手机上允许这台电脑调试</p></div>
        <AppButton variant="ghost" :disabled="busyRef" @click="refresh"><RefreshCw :size="15" aria-hidden="true" />刷新设备</AppButton>
      </div>
      <div v-if="!environmentRef?.devices.length" class="mt-5 flex items-center gap-4 rounded-control border border-dashed border-line bg-canvas/40 p-5">
        <div class="grid size-12 shrink-0 place-items-center rounded-2xl bg-surface-soft"><Cable :size="24" class="text-ink-muted" aria-hidden="true" /></div>
        <div><p class="text-sm text-ink-secondary">尚未连接手机</p><p class="mt-1 text-xs leading-6 text-ink-muted">{{ environmentRef?.ready ? '接上数据线、允许 USB 调试，再点击「刷新设备」' : '先初始化连接组件，再检查手机连接' }}</p></div>
      </div>
      <ul v-else class="mt-4 space-y-2" role="list">
        <li v-for="device in environmentRef.devices" :key="device.serial" class="flex items-center justify-between gap-3 rounded-control border border-line bg-canvas/50 px-4 py-3">
          <div class="flex min-w-0 items-center gap-3"><Smartphone :size="22" class="shrink-0 text-ink-secondary" aria-hidden="true" /><div class="min-w-0"><p class="truncate text-sm">{{ device.model }}</p><p class="mt-1 break-all text-xs text-ink-muted">{{ device.serial }}</p></div></div>
          <StatusPill :tone="device.state === 'device' ? 'success' : 'warning'">{{ stateLabels[device.state] ?? device.state }}</StatusPill>
        </li>
      </ul>
      <p v-if="environmentRef?.devices.some(d => d.state === 'unauthorized')" class="mt-3 rounded-control bg-warning-soft p-3 text-xs leading-6 text-warning">请查看手机上的「允许 USB 调试」弹窗，勾选「始终允许」并确认，再刷新设备。</p>
      <div class="mt-5 flex flex-wrap items-end justify-between gap-4 border-t border-line pt-5">
        <div class="w-full"><label for="workflow" class="mb-2 block text-xs text-ink-muted">已安装的工作流</label><select id="workflow" v-model="workflowKeyRef" class="min-h-10 w-full rounded-control border border-line bg-surface-soft px-3 py-2 text-sm" :disabled="busyRef"><option v-for="item in storeRef.installed" :key="item.key" :value="item.key">{{ item.workflow.name }} · {{ item.workflow.version }} · {{ item.registryUrl.replace('https://github.com/', '') }} / {{ item.reference }}</option></select><p class="mt-2 text-xs leading-6 text-ink-muted">{{ selectedWorkflowRef?.workflow.description }}</p></div>
        <div class="min-w-0 flex-1">
          <label for="phone" class="mb-2 block text-xs text-ink-muted">操作手机</label>
          <select id="phone" v-model="selectedRef" class="min-h-10 w-full rounded-control border border-line bg-surface-soft px-3 py-2 text-sm disabled:opacity-50" :disabled="busyRef || !readyDevicesRef.length">
            <option value="" disabled>请选择已授权的手机</option>
            <option v-for="device in readyDevicesRef" :key="device.serial" :value="device.serial">{{ device.model }} · {{ device.serial }}</option>
          </select>
        </div>
        <AppButton :loading="readingRef" :disabled="busyRef || !selectedDeviceRef || !selectedWorkflowRef" @click="readNickname"><Play v-if="!readingRef" :size="15" aria-hidden="true" />{{ readingRef ? '正在执行…' : '运行工作流' }}</AppButton>
      </div>
      <div class="mt-5 rounded-control bg-canvas/60 px-4 py-3">
        <ol class="flex flex-wrap items-center gap-2 text-xs text-ink-muted" role="list">
          <li v-for="(step, index) in selectedWorkflowRef?.workflow.steps" :key="index" class="flex items-center gap-2" :class="{ 'text-success': progressRef.step > index + 1, 'text-brand-strong': readingRef && progressRef.step === index + 1 }"><Check v-if="progressRef.step > index + 1" :size="13" aria-hidden="true" />{{ step.name }}<ArrowRight v-if="index < (selectedWorkflowRef?.workflow.steps.length ?? 0) - 1" :size="12" class="text-ink-muted" aria-hidden="true" /></li>
        </ol>
        <p v-if="readingRef" class="mt-3 text-xs text-brand-strong">{{ progressRef.message }} · 请暂时不要操作手机</p>
      </div>
    </section>

    <ResultPanel :result="resultRef" :busy="busyRef" @open-results="openResults" />

    <WorkflowStore :store="storeRef" :busy="busyRef" @sync="syncRegistry" @install="installWorkflow" />

    <section id="guide" class="scroll-mt-6 rounded-card border border-line bg-surface p-5">
      <h2 class="flex items-center gap-2 text-sm font-semibold"><CircleHelp :size="17" class="text-ink-muted" aria-hidden="true" />连接前需要做什么</h2>
      <ol class="mt-4 grid gap-4 text-xs leading-6 text-ink-secondary sm:grid-cols-3" role="list">
        <li><span class="mb-2 block font-medium text-ink">1. 开启 USB 调试</span>手机设置 → 开发者选项 → USB 调试。连接电脑后，在手机上点击「允许」。</li>
        <li><span class="mb-2 block font-medium text-ink">2. 准备微信</span>解锁手机，登录简体中文原版微信。遇到弹窗时先关闭，再回到微信主界面。</li>
        <li><span class="mb-2 block font-medium text-ink">3. 运行工作流</span>选择「读取微信昵称」并运行，核对软件里的昵称与手机「我 → 个人信息」页是否一致。</li>
      </ol>
      <p class="mt-4 border-t border-line pt-4 text-xs leading-6 text-ink-muted">仍找不到手机？换一根能传输数据的数据线或 USB 接口。Windows 部分手机需要先安装品牌官方 USB 驱动。</p>
    </section>
  </div>
</template>
