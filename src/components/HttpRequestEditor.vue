<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Plus, Trash2, FlaskConical } from '@lucide/vue';
import type { Auth, HttpPreview, HttpRequest, Pair } from '../workflowInput';
import AppButton from './AppButton.vue';

const props = defineProps<{ modelValue: HttpRequest; scope: string; secret: string; callback?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: HttpRequest]; 'update:secret': [value: string]; busy: [value: boolean] }>();
const previewRef = shallowRef<HttpPreview | null>(null);
const errorRef = ref('');
const testingRef = ref(false);
const bodyRef = ref('');
const parseInputRef = ref('');
const parsedRef = ref('');
const sampleOpenRef = ref(false);
const requestRef = computed(() => props.modelValue);
watch(() => props.modelValue, () => { previewRef.value = null; errorRef.value = ''; parsedRef.value = ''; });
watch(() => props.modelValue.body, body => { bodyRef.value = body === null ? '' : JSON.stringify(body, null, 2); }, { immediate: true });
function change(patch: Partial<HttpRequest>): void { emit('update:modelValue', { ...props.modelValue, ...patch }); }
function pairs(kind: 'query' | 'headers', index: number, patch: Partial<Pair>): void { change({ [kind]: requestRef.value[kind].map((p, i) => i === index ? { ...p, ...patch } : p) }); }
function auth(type: Auth['type']): void {
  const credential = '';
  const value: Auth = type === 'none' ? { type } : type === 'basic' ? { type, username: '', credential } : type === 'api_key' ? { type, name: 'X-API-Key', location: 'header', credential } : { type, credential };
  change({ auth: value }); emit('update:secret', '');
}
function changeAuth(patch: Record<string, string>): void { change({ auth: { ...requestRef.value.auth, ...patch } as Auth }); }
function saveBody(): void {
  try { change({ body: bodyRef.value.trim() ? JSON.parse(bodyRef.value) : null }); errorRef.value = ''; }
  catch { errorRef.value = '请求体不是有效 JSON，请修正后再保存或测试。'; }
}
function bodyChanged(event: Event): void {
  const field = event.target as HTMLTextAreaElement;
  try { if (field.value.trim()) JSON.parse(field.value); field.setCustomValidity(''); }
  catch { field.setCustomValidity('请求体需要为有效 JSON'); }
}
async function test(): Promise<void> {
  if (testingRef.value) return;
  errorRef.value = ''; previewRef.value = null;
  if (!isTauri()) { errorRef.value = '请在桌面客户端中测试 HTTP 请求。'; return; }
  try {
    if (requestRef.value.method === 'POST') { const body = bodyRef.value.trim() ? JSON.parse(bodyRef.value) : null; if (JSON.stringify(body) !== JSON.stringify(requestRef.value.body)) { change({ body }); } }
    testingRef.value = true; emit('busy', true);
    previewRef.value = await invoke<HttpPreview>('test_http_request', { request: { ...requestRef.value, body: requestRef.value.method === 'POST' && bodyRef.value.trim() ? JSON.parse(bodyRef.value) : null }, secret: props.secret || null });
    parseInputRef.value = previewRef.value.raw; parsedRef.value = previewRef.value.message;
    errorRef.value = previewRef.value.parseError ?? ''; sampleOpenRef.value = true;
  } catch (error) { errorRef.value = String(error); }
  finally { testingRef.value = false; emit('busy', false); }
}
async function parseOnly(): Promise<void> {
  if (isTauri()) {
    try { parsedRef.value = await invoke<string>('parse_http_response', { raw: parseInputRef.value, response: requestRef.value.response }); errorRef.value = ''; }
    catch (error) { errorRef.value = String(error); parsedRef.value = ''; }
    return;
  }
  try {
    if (requestRef.value.response.type === 'ignore') { parsedRef.value = '已配置忽略响应'; return; }
    let result: unknown = parseInputRef.value;
    if (requestRef.value.response.type === 'json') {
      result = JSON.parse(parseInputRef.value);
      const pointer = requestRef.value.response.pointer;
      if (pointer && !pointer.startsWith('/')) throw new Error('JSON Pointer 必须以 / 开头');
      for (const key of pointer ? pointer.slice(1).split('/') : []) result = typeof result === 'object' && result !== null ? (result as Record<string, unknown>)[key.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined;
    }
    if (typeof result !== 'string' || !result.trim()) throw new Error('解析结果需要是非空字符串');
    parsedRef.value = result; errorRef.value = '';
  } catch (error) { errorRef.value = String(error); parsedRef.value = ''; }
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex gap-2"><label class="sr-only" :for="`${scope}-method`">请求方式</label><select :id="`${scope}-method`" :value="requestRef.method" class="rounded-control border border-line bg-surface-soft px-2 text-xs" @change="change({ method: ($event.target as HTMLSelectElement).value as 'GET' | 'POST', body: null })"><option>GET</option><option>POST</option></select><div class="min-w-0 flex-1"><label class="sr-only" :for="`${scope}-url`">请求地址</label><input :id="`${scope}-url`" :value="requestRef.url" required type="url" class="min-h-8 w-full rounded-control border border-line bg-surface-soft px-3 text-xs" placeholder="https://example.com/api/message" @input="change({ url: ($event.target as HTMLInputElement).value })" /></div></div>
    <div v-for="kind in (['query', 'headers'] as const)" :key="kind" class="space-y-2">
      <div class="flex items-center justify-between"><span class="text-xs text-ink-secondary">{{ kind === 'query' ? '查询参数' : '请求头' }}</span><AppButton variant="ghost" @click="change({ [kind]: [...requestRef[kind], { name: '', value: '' }] })"><Plus :size="12" />添加</AppButton></div>
      <div v-for="(pair, index) in requestRef[kind]" :key="index" class="flex gap-2"><input :aria-label="`${kind === 'query' ? '参数' : '请求头'}名称 ${index + 1}`" :value="pair.name" required class="min-h-8 w-1/3 min-w-0 rounded-control border border-line bg-surface-soft px-2 text-xs" placeholder="名称" @input="pairs(kind, index, { name: ($event.target as HTMLInputElement).value })" /><input :aria-label="`值 ${index + 1}`" :value="pair.value" class="min-h-8 min-w-0 flex-1 rounded-control border border-line bg-surface-soft px-2 text-xs" placeholder="值" @input="pairs(kind, index, { value: ($event.target as HTMLInputElement).value })" /><AppButton variant="ghost" :aria-label="`删除${kind === 'query' ? '参数' : '请求头'} ${index + 1}`" @click="change({ [kind]: requestRef[kind].filter((_, i) => i !== index) })"><Trash2 :size="13" /></AppButton></div>
    </div>
    <div><label :for="`${scope}-auth`" class="mb-1.5 block text-xs text-ink-secondary">鉴权</label><select :id="`${scope}-auth`" :value="requestRef.auth.type" class="min-h-8 w-full rounded-control border border-line bg-surface-soft px-2 text-xs" @change="auth(($event.target as HTMLSelectElement).value as Auth['type'])"><option value="none">无需鉴权</option><option value="bearer">Bearer Token</option><option value="basic">Basic Auth</option><option value="api_key">API Key</option></select></div>
    <div v-if="requestRef.auth.type === 'basic'"><label :for="`${scope}-user`" class="mb-1.5 block text-xs text-ink-secondary">用户名</label><input :id="`${scope}-user`" :value="requestRef.auth.username" class="min-h-8 w-full rounded-control border border-line bg-surface-soft px-3 text-xs" @input="changeAuth({ username: ($event.target as HTMLInputElement).value })" /></div>
    <div v-if="requestRef.auth.type === 'api_key'" class="flex gap-2"><input aria-label="API Key 名称" :value="requestRef.auth.name" required class="min-h-8 min-w-0 flex-1 rounded-control border border-line bg-surface-soft px-3 text-xs" @input="changeAuth({ name: ($event.target as HTMLInputElement).value })" /><select aria-label="API Key 位置" :value="requestRef.auth.location" class="rounded-control border border-line bg-surface-soft px-2 text-xs" @change="changeAuth({ location: ($event.target as HTMLSelectElement).value })"><option value="header">放入请求头</option><option value="query">放入查询参数</option></select></div>
    <div v-if="requestRef.auth.type !== 'none'"><label :for="`${scope}-secret`" class="mb-1.5 block text-xs text-ink-secondary">{{ requestRef.auth.type === 'basic' ? '密码' : '鉴权值' }}</label><input :id="`${scope}-secret`" :value="secret" type="password" autocomplete="new-password" maxlength="2000" :required="!requestRef.auth.credential" class="min-h-8 w-full rounded-control border border-line bg-surface-soft px-3 text-xs" :placeholder="requestRef.auth.credential ? '已安全保存；留空保留原值' : '输入鉴权值'" @input="emit('update:secret', ($event.target as HTMLInputElement).value)" /><p class="mt-1 text-xs text-ink-muted">鉴权值存入系统凭据库，不写入工作流、日志或导出文件。</p></div>
    <div v-if="requestRef.method === 'POST'"><label :for="`${scope}-body`" class="mb-1.5 block text-xs text-ink-secondary">JSON 请求体</label><textarea :id="`${scope}-body`" v-model="bodyRef" rows="3" class="w-full rounded-control border border-line bg-surface-soft p-2 font-mono text-xs" placeholder='{"type":"daily"}' @input="bodyChanged" @blur="saveBody" /></div>
    <div class="grid grid-cols-2 gap-3"><div><label :for="`${scope}-parser`" class="mb-1.5 block text-xs text-ink-secondary">响应解析</label><select :id="`${scope}-parser`" :value="requestRef.response.type" class="min-h-8 w-full rounded-control border border-line bg-surface-soft px-2 text-xs" @change="change({ response: ($event.target as HTMLSelectElement).value === 'json' ? { type: 'json', pointer: '/message' } : { type: ($event.target as HTMLSelectElement).value as 'text' | 'ignore' } })"><option value="json">JSON 字段</option><option value="text">纯文本</option><option v-if="callback" value="ignore">忽略响应（含 204）</option></select></div><div><label :for="`${scope}-timeout`" class="mb-1.5 block text-xs text-ink-secondary">超时（秒）</label><input :id="`${scope}-timeout`" :value="requestRef.timeoutSeconds" type="number" required min="1" max="60" class="min-h-8 w-full rounded-control border border-line bg-surface-soft px-3 text-xs" @input="change({ timeoutSeconds: Number(($event.target as HTMLInputElement).value) })" /></div></div>
    <div v-if="requestRef.response.type === 'json'"><label :for="`${scope}-pointer`" class="mb-1.5 block text-xs text-ink-secondary">JSON Pointer</label><input :id="`${scope}-pointer`" :value="requestRef.response.pointer" class="min-h-8 w-full rounded-control border border-line bg-surface-soft px-3 font-mono text-xs" placeholder="/data/message" @input="change({ response: { type: 'json', pointer: ($event.target as HTMLInputElement).value } })" /><p class="mt-1 text-xs text-ink-muted">例如响应为 {"data":{"message":"Ok"}}，填写 /data/message。</p></div>
    <AppButton variant="secondary" :loading="testingRef" @click="test"><FlaskConical :size="13" />测试请求与解析</AppButton>
    <p v-if="previewRef" class="text-xs" :class="previewRef.parseError ? 'text-warning' : 'text-success'" role="status">HTTP {{ previewRef.status }} · {{ previewRef.elapsedMs }} ms · {{ new Date(previewRef.fetchedAt).toLocaleTimeString('zh-CN') }} · 测试未操作手机</p>
    <details :open="sampleOpenRef" class="rounded-control border border-line p-2" @toggle="sampleOpenRef = ($event.target as HTMLDetailsElement).open"><summary class="cursor-pointer text-xs text-ink-secondary">响应预览与单独解析测试</summary><label :for="`${scope}-sample`" class="mt-2 mb-1 block text-xs text-ink-muted">响应样本（可粘贴，不发起请求）</label><textarea :id="`${scope}-sample`" v-model="parseInputRef" rows="3" class="w-full rounded-control border border-line bg-surface-soft p-2 font-mono text-xs" /><AppButton variant="ghost" @click="parseOnly">只测试解析</AppButton></details>
    <div v-if="parsedRef" class="rounded-control bg-success-soft p-3 text-xs leading-5 text-success"><p class="font-medium">解析结果</p><pre class="mt-1 font-sans whitespace-pre-wrap wrap-anywhere">{{ parsedRef }}</pre></div>
    <p v-if="errorRef" role="alert" class="rounded-control bg-danger-soft px-3 py-2 text-xs leading-5 text-danger wrap-anywhere">{{ errorRef }}</p>
  </div>
</template>
