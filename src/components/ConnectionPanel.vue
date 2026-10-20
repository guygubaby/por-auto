<script setup lang="ts">
import { ref } from 'vue';
import { ArrowRight, Cable, Check, Download, Play, RefreshCw, ShieldCheck, Smartphone, Settings2, Usb } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { RouterLink } from 'vue-router';
import { useConnectionStore } from '../useConnection';
import AppButton from './AppButton.vue';
import DeviceRunProgress from './DeviceRunProgress.vue';
import DevicePicker from './DevicePicker.vue';
import StatusPill from './StatusPill.vue';
import WorkflowConfigDialog from './WorkflowConfigDialog.vue';
const configuringRef = ref(false);

const connection = useConnectionStore();
const { environmentRef, selectedSerialsRef, busyRef, runningRef, stoppingRef, progressRef, deviceRunsRef, batchSummaryRef, readyDevicesRef, selectedDevicesRef, storeRef, workflowKeyRef, selectedWorkflowRef } = storeToRefs(connection);
const { refresh, initialize, runWorkflow } = connection;
const stateLabels: Record<string, string> = { device: '可以使用', unauthorized: '等待手机授权', offline: '设备离线', recovery: '恢复模式', sideload: '刷机模式', no: '连接权限不足' };
</script>

<template>
  <div class="space-y-4">
    <section id="connect" class="scroll-mt-6 rounded-card border border-line bg-surface p-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="grid size-8 place-items-center rounded-control bg-brand-soft text-brand-strong"><ShieldCheck :size="20" aria-hidden="true" /></div>
          <div><h2 class="text-sm font-semibold">连接环境</h2><p class="mt-1 text-xs text-ink-muted">连接与自动化组件随软件提供，无需安装其他运行环境</p></div>
        </div>
        <StatusPill :tone="environmentRef?.ready ? 'success' : 'warning'">{{ environmentRef?.ready ? '组件已就绪' : '待初始化' }}</StatusPill>
      </div>
      <div class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-control border border-line bg-canvas/50 px-4 py-3">
        <div class="flex items-center gap-3 text-sm"><Usb :size="18" class="text-ink-muted" aria-hidden="true" /><span>Android 连接与自动化组件</span><span v-if="environmentRef" class="text-xs text-ink-muted">{{ environmentRef.version }} · 自动化 {{ environmentRef.automation_version ?? '0.4.0' }}</span></div>
        <AppButton :variant="environmentRef?.ready ? 'secondary' : 'primary'" :loading="busyRef && !runningRef" :disabled="runningRef" @click="initialize"><Check v-if="environmentRef?.ready" :size="15" aria-hidden="true" /><Download v-else :size="15" aria-hidden="true" />{{ environmentRef?.ready ? '重新初始化' : '初始化连接组件' }}</AppButton>
      </div>
    </section>

    <section class="rounded-card border border-line bg-surface p-4">
      <div class="flex items-center justify-between gap-3">
        <div><h2 class="text-sm font-semibold">连接的手机</h2><p class="mt-1 text-xs text-ink-muted">先解锁手机，并在手机上允许这台电脑调试</p></div>
        <AppButton variant="ghost" :disabled="busyRef" @click="refresh"><RefreshCw :size="15" aria-hidden="true" />刷新设备</AppButton>
      </div>
      <div v-if="!environmentRef?.devices.length" class="mt-4 flex items-center gap-3 rounded-control border border-dashed border-line bg-canvas/40 p-4">
        <div class="grid size-12 shrink-0 place-items-center rounded-2xl bg-surface-soft"><Cable :size="24" class="text-ink-muted" aria-hidden="true" /></div>
        <div><p class="text-sm text-ink-secondary">尚未连接手机</p><p class="mt-1 text-xs leading-5 text-ink-muted">{{ environmentRef?.ready ? '接上数据线、允许 USB 调试，再点击「刷新设备」' : '先初始化连接组件，再检查手机连接' }}</p></div>
      </div>
      <ul v-else class="mt-3 space-y-2" role="list">
        <li v-for="device in environmentRef.devices" :key="device.serial" class="flex items-center justify-between gap-3 rounded-control border border-line bg-canvas/50 px-4 py-3">
          <div class="flex min-w-0 items-center gap-3"><Smartphone :size="22" class="shrink-0 text-ink-secondary" aria-hidden="true" /><div class="min-w-0"><p class="truncate text-sm">{{ device.model }}</p><p class="mt-1 break-all text-xs text-ink-muted">{{ device.serial }}</p></div></div>
          <StatusPill :tone="device.state === 'device' ? 'success' : 'warning'">{{ stateLabels[device.state] ?? device.state }}</StatusPill>
        </li>
      </ul>
      <p v-if="environmentRef?.devices.some(d => d.state === 'unauthorized')" class="mt-3 rounded-control bg-warning-soft p-3 text-xs leading-5 text-warning">请查看手机上的「允许 USB 调试」弹窗，勾选「始终允许」并确认，再刷新设备。</p>
      <div class="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-line pt-4">
        <div class="w-full"><label for="workflow" class="mb-2 block text-xs text-ink-muted">已安装的工作流</label><select id="workflow" v-model="workflowKeyRef" class="min-h-8 w-full rounded-control border border-line bg-surface-soft px-3 py-2 text-sm pointer-coarse:min-h-11" :disabled="busyRef"><option v-for="item in storeRef.installed" :key="item.key" :value="item.key">{{ item.workflow.name }} · {{ item.workflow.version }} · {{ item.registryUrl.replace('https://github.com/', '') }} / {{ item.reference }}</option></select><p class="mt-2 text-xs leading-5 text-ink-muted">{{ selectedWorkflowRef?.workflow.description }}</p><p v-if="selectedWorkflowRef?.workflow.inputSchema && !selectedWorkflowRef.input" class="mt-2 text-xs text-warning">先点击「配置输入与运行前后操作」，设置消息与接收会话后即可运行。</p></div>
        <AppButton v-if="selectedWorkflowRef" variant="secondary" :disabled="busyRef" @click="configuringRef = true"><Settings2 :size="14" />配置输入与运行前后操作</AppButton>
        <DevicePicker v-model="selectedSerialsRef" :devices="readyDevicesRef" :disabled="busyRef" />
        <div class="flex w-full flex-wrap items-center justify-between gap-3"><p class="text-xs text-ink-secondary" aria-live="polite">{{ runningRef ? `运行中 ${batchSummaryRef.running} 台 · 排队 ${batchSummaryRef.queued} 台 · 已处理 ${batchSummaryRef.done} / ${batchSummaryRef.total} 台` : `${selectedWorkflowRef?.dryRun ? '演练 · 不点击发送 · ' : ''}已选择 ${selectedDevicesRef.length} 台手机` }}</p><AppButton v-if="runningRef" variant="secondary" :disabled="stoppingRef" @click="connection.stopWorkflows">{{ stoppingRef ? '正在停止…' : '停止后续操作' }}</AppButton><AppButton :loading="runningRef" :disabled="busyRef || !selectedDevicesRef.length || !selectedWorkflowRef || (!!selectedWorkflowRef.workflow.inputSchema && !selectedWorkflowRef.input)" @click="runWorkflow"><Play v-if="!runningRef" :size="15" aria-hidden="true" />{{ runningRef ? '正在执行…' : `${selectedWorkflowRef?.dryRun ? '开始演练' : selectedWorkflowRef?.workflow.steps.some(step => ['wechat_send_text', 'wechat_broadcast'].includes(step.action?.type ?? '')) ? '运行并发送' : '运行工作流'}${selectedDevicesRef.length ? `（${selectedDevicesRef.length} 台）` : ''}` }}</AppButton></div>
      </div>
      <div v-if="!runningRef || deviceRunsRef.length === 1" class="mt-4 rounded-control bg-canvas/60 px-4 py-3">
        <ol class="flex flex-wrap items-center gap-2 text-xs text-ink-muted" role="list">
          <li v-for="(step, index) in selectedWorkflowRef?.workflow.steps" :key="index" class="flex items-center gap-2" :class="{ 'text-success': progressRef.step > index + 1, 'text-brand-strong': runningRef && progressRef.step === index + 1 }"><Check v-if="progressRef.step > index + 1" :size="13" aria-hidden="true" />{{ step.name }}<ArrowRight v-if="index < (selectedWorkflowRef?.workflow.steps.length ?? 0) - 1" :size="12" class="text-ink-muted" aria-hidden="true" /></li>
        </ol>
        <p v-if="runningRef" class="mt-3 text-xs text-brand-strong">{{ progressRef.message }} · 请暂时不要操作手机</p>
      </div>
      <DeviceRunProgress v-if="runningRef" :runs="deviceRunsRef" />
    </section>

    <WorkflowConfigDialog :item="configuringRef ? selectedWorkflowRef ?? null : null" @close="configuringRef = false" />
    <RouterLink v-if="deviceRunsRef.length" to="/results" class="block rounded-control border border-brand/30 bg-brand-soft px-4 py-3 text-sm text-brand-strong">{{ runningRef ? `已处理 ${batchSummaryRef.done} / ${batchSummaryRef.total} 台手机` : `本次执行 ${batchSummaryRef.total} 台手机，成功 ${batchSummaryRef.succeeded} 台，失败 ${batchSummaryRef.failed} 台` }} · 查看每台手机的运行结果</RouterLink>
  </div>
</template>
