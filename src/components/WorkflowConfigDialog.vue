<script setup lang="ts">
import { computed, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { RefreshCw, X } from '@lucide/vue';
import { useConnectionStore, type ExecutionMode, type Installed } from '../useConnection';
import { defaultRequest, defaultSendInput, type Hooks, type SendInput, type TargetList } from '../workflowInput';
import AppButton from './AppButton.vue';
import HttpRequestEditor from './HttpRequestEditor.vue';

const props = defineProps<{ item: Installed | null }>();
const emit = defineEmits<{ close: [] }>();
const connection = useConnectionStore();
const { readyDevicesRef, busyRef, errorRef } = storeToRefs(connection);
const dialogRef = useTemplateRef<HTMLDialogElement>('dialog');
const sendInputRef = shallowRef<SendInput>(defaultSendInput());
const beforeRef = shallowRef(defaultRequest());
const afterRef = shallowRef(defaultRequest());
const beforeEnabledRef = ref(false);
const afterEnabledRef = ref(false);
const beforeSecretRef = ref('');
const afterSecretRef = ref('');
const messageSecretRef = ref('');
const scanSerialRef = ref('');
const listRef = shallowRef<TargetList | null>(null);
const localErrorRef = ref('');
const scanningRef = ref(false);
const httpBusyRef = ref(false);
const filterRef = ref('');
const namesTextRef = ref('');
const executionModeRef = ref<ExecutionMode>('native');
const dryRunRef = ref(false);
const sendableRef = computed(() => props.item?.workflow.steps.some(s => ['wechat_send_text', 'wechat_broadcast', 'chat_send_text', 'chat_broadcast'].includes(s.action?.type ?? '')) ?? false);
const genericTapRef = computed(() => props.item?.workflow.steps.some(s => s.action?.type === 'tap') ?? false);
const sendingRef = computed(() => props.item?.workflow.steps.some(s => ['wechat_broadcast', 'chat_broadcast'].includes(s.action?.type ?? '')) ?? false);
const namesRef = computed(() => [...new Set([...(listRef.value?.items.map(c => c.title) ?? []), ...sendInputRef.value.recipients.names])].filter(name => name.toLowerCase().includes(filterRef.value.toLowerCase())));
const blockedRef = computed(() => busyRef.value || scanningRef.value || httpBusyRef.value);

watch(() => props.item, item => {
  localErrorRef.value = ''; listRef.value = null; filterRef.value = '';
  beforeSecretRef.value = ''; afterSecretRef.value = ''; messageSecretRef.value = '';
  if (item) {
    executionModeRef.value = item.executionMode ?? 'native';
    dryRunRef.value = item.dryRun ?? false;
    sendInputRef.value = structuredClone(item.input ?? defaultSendInput());
    beforeRef.value = structuredClone(item.hooks?.beforeRun ?? defaultRequest());
    afterRef.value = structuredClone(item.hooks?.afterRun ?? { ...defaultRequest(), response: { type: 'ignore' } });
    beforeEnabledRef.value = !!item.hooks?.beforeRun; afterEnabledRef.value = !!item.hooks?.afterRun;
    scanSerialRef.value = connection.selectedSerialsRef[0] ?? readyDevicesRef.value[0]?.serial ?? '';
    namesTextRef.value = sendInputRef.value.recipients.names.join('\n');
    dialogRef.value?.showModal();
  } else dialogRef.value?.close();
});
function update(patch: Partial<SendInput>): void { sendInputRef.value = { ...sendInputRef.value, ...patch }; }
function messageType(type: string): void { update({ message: type === 'before_run' ? { type: 'before_run' } : type === 'http' ? { type: 'http', request: defaultRequest(), refresh: 'run' } : { type: 'manual', text: '' } }); if (type === 'before_run') beforeEnabledRef.value = true; }
function recipients(patch: Partial<SendInput['recipients']>): void {
  update({ recipients: { ...sendInputRef.value.recipients, ...patch } }); namesTextRef.value = sendInputRef.value.recipients.names.join('\n');
}
function toggle(name: string, checked: boolean): void { recipients({ names: checked ? [...new Set([...sendInputRef.value.recipients.names, name])] : sendInputRef.value.recipients.names.filter(n => n !== name) }); }
async function scan(): Promise<void> {
  if (blockedRef.value) return;
  if (!isTauri()) { localErrorRef.value = '请在桌面客户端连接手机后读取列表。'; return; }
  scanningRef.value = true; localErrorRef.value = '';
  try { listRef.value = await invoke<TargetList>('list_wechat_targets', { serial: scanSerialRef.value, scope: sendInputRef.value.recipients.scope, executionMode: executionModeRef.value, package: props.item?.workflow.package }); }
  catch (error) { localErrorRef.value = String(error); }
  finally { scanningRef.value = false; }
}
async function stopScan(): Promise<void> {
  try { await invoke('cancel_device_tasks', { serials: [scanSerialRef.value] }); }
  catch (error) { localErrorRef.value = String(error); }
}
async function save(): Promise<void> {
  if (!props.item || blockedRef.value) return;
  const hooks: Hooks = { beforeRun: beforeEnabledRef.value ? beforeRef.value : null, afterRun: afterEnabledRef.value ? afterRef.value : null };
  const input = sendingRef.value ? sendInputRef.value : null;
  if (await connection.configureWorkflow(props.item, input, hooks, { before: beforeSecretRef.value, after: afterSecretRef.value, message: messageSecretRef.value }, executionModeRef.value, sendableRef.value && dryRunRef.value)) emit('close');
  else localErrorRef.value = errorRef.value;
}
function dismiss(event?: Event): void { if (blockedRef.value) { event?.preventDefault(); return; } emit('close'); }
function backdrop(event: MouseEvent): void {
  const dialog = dialogRef.value;
  if (!dialog || 'closedBy' in HTMLDialogElement.prototype || event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dismiss();
}
</script>

<template>
  <dialog ref="dialog" :closedby="blockedRef ? 'none' : 'any'" class="fixed inset-0 m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-card border border-line bg-surface p-4 text-ink shadow-2xl backdrop:bg-black/70" aria-labelledby="workflow-config-title" @close="dismiss" @cancel="dismiss" @click="backdrop">
    <div class="flex items-start justify-between gap-3"><div><h2 id="workflow-config-title" class="text-sm font-semibold">配置 · {{ item?.workflow.name }}</h2><p class="mt-1 text-xs text-ink-muted">运行前 → 执行工作流 → 运行后。配置和版本保存在本机。</p></div><AppButton variant="ghost" aria-label="关闭工作流配置" :disabled="blockedRef" @click="dismiss()"><X :size="16" /></AppButton></div>
    <form class="mt-4 space-y-4" :aria-busy="blockedRef" @submit.prevent="save">
      <fieldset v-if="sendableRef" :disabled="blockedRef" class="space-y-2 rounded-control border border-line p-3"><legend class="px-1 text-xs font-semibold">运行方式</legend><label class="flex items-center gap-2 text-xs"><input v-model="dryRunRef" type="checkbox" name="dryRun" aria-describedby="rehearsal-help" class="accent-brand" :disabled="genericTapRef && !dryRunRef" />演练模式：填写并核对消息，不点击发送</label><p v-if="genericTapRef" id="rehearsal-help" class="text-xs leading-5 text-warning">此工作流含通用点击，暂不支持消息演练，请使用标准消息发送动作。</p><p v-else-if="dryRunRef" id="rehearsal-help" class="text-xs leading-5 text-ink-muted">逐个进入会话验证内容，新建草稿核对后清理；已有相同草稿保持原样，其他草稿不会覆盖。HTTP 接口和前后置 Hook 仍会正常执行。已有定时任务保留原快照。</p><p v-else id="rehearsal-help" class="text-xs leading-5 text-warning">正式运行：会点击发送。首次验证流程可以先开启演练模式。</p></fieldset>
      <fieldset :disabled="blockedRef" class="space-y-2 rounded-control border border-line p-3"><legend class="px-1 text-xs font-semibold">执行方式</legend><div class="flex flex-wrap gap-4"><label class="flex items-center gap-2 text-xs"><input v-model="executionModeRef" type="radio" name="executionMode" value="native" class="accent-brand" @change="listRef = null" />原生控件（默认）</label><label v-if="item?.workflow.package === 'com.tencent.mm'" class="flex items-center gap-2 text-xs"><input v-model="executionModeRef" type="radio" name="executionMode" value="visual" class="accent-brand" @change="listRef = null" />视觉 AI</label></div><p v-if="executionModeRef === 'visual'" class="text-xs leading-5 text-warning">手机截图将发送到你在「模型设置」保存的接口。请先配置、测试并允许截图；中文输入需要手机已安装 AutoJs6，无需开启无障碍。模型只定位页面，不改消息和接收对象。</p><p v-else class="text-xs leading-5 text-ink-muted">使用原生控件读取与操作，不调用模型；页面控件为空时停止。</p></fieldset>
      <fieldset :disabled="blockedRef" class="space-y-3 rounded-control border border-line p-3"><legend class="px-1 text-xs font-semibold">1 · 运行前</legend><label class="flex items-center gap-2 text-xs"><input v-model="beforeEnabledRef" type="checkbox" class="accent-brand" />运行前调用接口（Pre Hook）</label><p class="text-xs leading-5 text-ink-muted">每台手机的每轮运行开始前执行一次；失败则不执行手机操作。批量发送的消息接口可在下一步独立设置。</p><HttpRequestEditor v-if="beforeEnabledRef" v-model="beforeRef" v-model:secret="beforeSecretRef" scope="before-hook" @busy="httpBusyRef = $event" /></fieldset>
      <fieldset v-if="sendingRef" :disabled="blockedRef" class="space-y-3 rounded-control border border-line p-3"><legend class="px-1 text-xs font-semibold">2 · 消息与接收会话</legend>
        <div><label for="message-source" class="mb-1.5 block text-xs text-ink-secondary">消息来源</label><select id="message-source" :value="sendInputRef.message.type" class="min-h-8 w-full rounded-control border border-line bg-surface-soft px-2 text-xs" @change="messageType(($event.target as HTMLSelectElement).value)"><option value="manual">手动输入</option><option value="http">调用 HTTP 接口获取</option><option value="before_run">使用前置 Hook 的解析结果</option></select></div>
        <div v-if="sendInputRef.message.type === 'manual'"><label for="message-text" class="mb-1.5 block text-xs text-ink-secondary">发送内容</label><textarea id="message-text" :value="sendInputRef.message.text" required rows="3" class="w-full rounded-control border border-line bg-surface-soft p-2 text-sm" placeholder="输入本轮消息" @input="update({ message: { type: 'manual', text: ($event.target as HTMLTextAreaElement).value } })" /></div>
        <template v-else-if="sendInputRef.message.type === 'http'"><label for="message-refresh" class="block text-xs text-ink-secondary">获取最新数据的时机</label><select id="message-refresh" :value="sendInputRef.message.refresh" class="min-h-8 w-full rounded-control border border-line bg-surface-soft px-2 text-xs" @change="update({ message: { ...sendInputRef.message, refresh: ($event.target as HTMLSelectElement).value as 'run' | 'recipient' } })"><option value="run">本轮发送前获取一次，所有会话使用相同内容</option><option value="recipient">每个会话发送前重新获取最新内容</option></select><p v-pre class="text-xs leading-5 text-ink-muted">每个会话前获取时，参数值支持 {{recipient.title}}、{{recipient.index}}；也可使用 {{device.serial}}。测试请求使用示例数据。</p><HttpRequestEditor :model-value="sendInputRef.message.request" v-model:secret="messageSecretRef" scope="message-http" @update:model-value="update({ message: { type: 'http', refresh: sendInputRef.message.type === 'http' ? sendInputRef.message.refresh : 'run', request: $event } })" @busy="httpBusyRef = $event" /></template>
        <div class="grid grid-cols-2 gap-3"><div><label for="recipient-scope" class="mb-1.5 block text-xs text-ink-secondary">会话范围</label><select id="recipient-scope" :value="sendInputRef.recipients.scope" class="min-h-8 w-full rounded-control border border-line bg-surface-soft px-2 text-xs" @change="recipients({ scope: ($event.target as HTMLSelectElement).value as 'groups' | 'conversations', names: [] }); listRef = null"><option value="groups">仅群聊</option><option value="conversations">全部会话类型（含普通聊天）</option></select></div><div><label for="recipient-mode" class="mb-1.5 block text-xs text-ink-secondary">接收对象</label><select id="recipient-mode" :value="sendInputRef.recipients.mode" class="min-h-8 w-full rounded-control border border-line bg-surface-soft px-2 text-xs" @change="recipients({ mode: ($event.target as HTMLSelectElement).value as 'all' | 'selected' })"><option value="selected">勾选指定会话</option><option value="all">本次列表中全部可发送会话</option></select></div></div>
        <div class="flex gap-2"><select v-model="scanSerialRef" aria-label="读取列表的手机" class="min-h-8 min-w-0 flex-1 rounded-control border border-line bg-surface-soft px-2 text-xs"><option value="">选择一台手机读取会话</option><option v-for="device in readyDevicesRef" :key="device.serial" :value="device.serial">{{ device.model }} · {{ device.serial }}</option></select><AppButton variant="secondary" :disabled="!scanSerialRef || blockedRef" :loading="scanningRef" @click="scan"><RefreshCw v-if="!scanningRef" :size="13" />读取会话</AppButton></div>
        <p v-if="listRef" class="text-xs text-ink-muted">已读取 {{ listRef.items.length }} 个 · {{ listRef.source }} · {{ new Date(listRef.scannedAt).toLocaleTimeString('zh-CN') }}</p>
        <template v-if="sendInputRef.recipients.mode === 'selected'"><input v-model="filterRef" aria-label="筛选会话" class="min-h-8 w-full rounded-control border border-line bg-surface-soft px-3 text-xs" placeholder="搜索已读取的会话" /><div v-if="namesRef.length" class="space-y-2"><div class="flex gap-3"><AppButton variant="ghost" @click="recipients({ names: [...new Set([...sendInputRef.recipients.names, ...namesRef])] })">全选当前列表</AppButton><AppButton variant="ghost" @click="recipients({ names: [] })">清空选择</AppButton><span class="self-center text-xs text-ink-muted">已选 {{ sendInputRef.recipients.names.length }}</span></div><ul class="grid max-h-44 gap-1 overflow-y-auto sm:grid-cols-2"><li v-for="name in namesRef" :key="name"><label class="flex items-center gap-2 rounded-control bg-surface-soft px-2 py-2 text-xs"><input type="checkbox" class="accent-brand" :checked="sendInputRef.recipients.names.includes(name)" @change="toggle(name, ($event.target as HTMLInputElement).checked)" /><span class="wrap-anywhere">{{ name }}</span><span v-if="listRef && !listRef.items.some(c => c.title === name)" class="shrink-0 text-warning">本次未发现</span></label></li></ul></div><details><summary class="cursor-pointer text-xs text-ink-muted">手动填写会话名称</summary><label for="recipient-names" class="mt-2 mb-1 block text-xs text-ink-muted">每行一个完整名称；运行时会重新核对，同名会话会停止。</label><textarea id="recipient-names" v-model="namesTextRef" rows="3" class="w-full rounded-control border border-line bg-surface-soft p-2 text-xs" @change="recipients({ names: [...new Set(namesTextRef.split('\n').map(n => n.trim()).filter(Boolean))] })" /></details></template>
        <p v-else class="rounded-control bg-warning-soft p-2 text-xs leading-5 text-warning">运行时会重新读取并固定本次名单，再依次{{ dryRunRef ? '演练' : '发送' }}。范围以手机列表实际可枚举的会话为准。</p>
        <div><label for="send-interval" class="mb-1.5 block text-xs text-ink-secondary">会话之间的间隔（秒）</label><input id="send-interval" :value="sendInputRef.intervalMs / 1000" type="number" required min="0.5" max="60" step="0.5" class="min-h-8 w-28 rounded-control border border-line bg-surface-soft px-3 text-xs" @input="update({ intervalMs: Number(($event.target as HTMLInputElement).value) * 1000 })" /></div>
      </fieldset>
      <fieldset :disabled="blockedRef" class="space-y-3 rounded-control border border-line p-3"><legend class="px-1 text-xs font-semibold">{{ sendingRef ? '3' : '2' }} · 运行后</legend><label class="flex items-center gap-2 text-xs"><input v-model="afterEnabledRef" type="checkbox" class="accent-brand" />结束后调用接口（Post Hook，成功或失败都会执行）</label><template v-if="afterEnabledRef"><p v-pre class="text-xs leading-5 text-ink-muted">参数、请求头值和请求体支持 {{run.status}}、{{run.id}}、{{device.serial}}、{{outputs.nickname}} 等变量。回调失败会保存警告，不会重新执行手机动作。</p><HttpRequestEditor v-model="afterRef" v-model:secret="afterSecretRef" scope="after-hook" callback @busy="httpBusyRef = $event" /></template></fieldset>
      <p v-if="localErrorRef" role="alert" class="rounded-control bg-danger-soft px-3 py-2 text-xs leading-5 text-danger wrap-anywhere">{{ localErrorRef }}</p>
      <div class="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3"><p class="text-xs text-ink-muted">保存配置不会运行。已有定时任务保留原快照。</p><div class="flex gap-2"><AppButton v-if="scanningRef" variant="secondary" @click="stopScan">停止读取</AppButton><AppButton variant="secondary" :disabled="blockedRef" @click="dismiss()">取消</AppButton><button type="submit" :disabled="blockedRef" class="min-h-8 rounded-control bg-brand px-3 py-1.5 text-sm text-white disabled:opacity-45">保存配置</button></div></div>
    </form>
  </dialog>
</template>
