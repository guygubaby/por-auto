<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Eye, EyeOff, FlaskConical, Save } from '@lucide/vue';
import AppButton from './AppButton.vue';

interface Config { baseUrl: string; model: string; credential: string | null; allowScreenshots: boolean; timeoutSeconds: number; thinking?: boolean | null }
interface TestResult { model: string; elapsedMs: number; message: string }
const configRef = shallowRef<Config>({ baseUrl: '', model: '', credential: null, allowScreenshots: false, timeoutSeconds: 60, thinking: null });
const secretRef = ref('');
const useKeyRef = ref(true);
const showKeyRef = ref(false);
const busyRef = ref(false);
const loadedRef = ref(false);
const errorRef = ref('');
const noticeRef = ref('');
const testRef = shallowRef<TestResult | null>(null);
const destinationRef = computed(() => { try { return new URL(configRef.value.baseUrl).origin; } catch { return '上方填写的模型接口'; } });
function update(patch: Partial<Config>): void {
  const changedUrl = patch.baseUrl !== undefined && patch.baseUrl !== configRef.value.baseUrl;
  if (changedUrl) { secretRef.value = ''; showKeyRef.value = false; }
  const changedModel = patch.model !== undefined && patch.model !== configRef.value.model;
  configRef.value = { ...configRef.value, ...patch, ...(changedUrl ? { credential: null, allowScreenshots: false } : {}), ...(changedUrl || changedModel ? { thinking: null } : {}) };
  testRef.value = null; noticeRef.value = ''; errorRef.value = '';
}
function payload(): Config {
  if (useKeyRef.value && !secretRef.value && !configRef.value.credential) throw new Error('请填写 API Key；本机无鉴权模型可取消「使用 API Key」。');
  return { ...configRef.value, credential: useKeyRef.value ? configRef.value.credential : null };
}
async function action(test: boolean): Promise<void> {
  if (busyRef.value || !loadedRef.value) return;
  if (!isTauri()) { errorRef.value = '请在桌面客户端配置模型接口。'; return; }
  errorRef.value = ''; noticeRef.value = ''; busyRef.value = true;
  try {
    const args = { config: payload(), secret: useKeyRef.value && secretRef.value ? secretRef.value : null };
    if (test) testRef.value = await invoke<TestResult>('test_vision_provider', args);
    else {
      configRef.value = await invoke<Config>('save_vision_provider', args);
      secretRef.value = ''; showKeyRef.value = false;
      noticeRef.value = '模型设置已保存。工作流默认仍使用原生模式；请在对应工作流的「配置」中选择视觉执行。';
    }
  } catch (error) { errorRef.value = String(error); }
  finally { busyRef.value = false; }
}
onMounted(async () => {
  if (!isTauri()) { loadedRef.value = true; return; }
  busyRef.value = true;
  try {
    const value = await invoke<Config | null>('vision_provider');
    if (value) { configRef.value = value; useKeyRef.value = !!value.credential; }
    loadedRef.value = true;
  } catch (error) { errorRef.value = String(error); }
  finally { busyRef.value = false; }
});
</script>

<template>
  <section class="max-w-2xl rounded-card border border-line bg-surface p-4">
    <h2 class="text-sm font-semibold">视觉执行 · Provider</h2>
    <p id="provider-help" class="mt-2 text-xs leading-5 text-ink-secondary">原生控件无法读取时，可为单个工作流选择视觉执行。使用支持图像输入和 JSON 响应的 OpenAI 兼容接口；不需要安装 Python 或下载模型权重。</p>
    <form method="post" class="mt-4 space-y-4" :aria-busy="busyRef" aria-describedby="provider-help" @submit.prevent="action(false)">
      <fieldset :disabled="busyRef || !loadedRef" class="space-y-3">
        <legend class="sr-only">模型连接与截图设置</legend>
        <div>
          <label for="provider-url" class="mb-1.5 block text-xs text-ink-secondary">Base URL</label>
          <input id="provider-url" name="baseUrl" :value="configRef.baseUrl" type="url" required maxlength="2000" autocomplete="off" autocapitalize="off" autocorrect="off" :spellcheck="false" aria-describedby="provider-url-help" class="min-h-8 w-full rounded-control border border-line bg-surface-soft px-3 text-sm" placeholder="https://api.example.com/v1" @input="update({ baseUrl: ($event.target as HTMLInputElement).value })" />
          <p id="provider-url-help" class="mt-1 text-xs text-ink-muted">填写接口根路径，软件会追加 /chat/completions。本机模型可使用 http://127.0.0.1。</p>
        </div>
        <div>
          <label for="provider-model" class="mb-1.5 block text-xs text-ink-secondary">图像模型 ID</label>
          <input id="provider-model" name="model" :value="configRef.model" required maxlength="200" autocomplete="off" autocapitalize="off" autocorrect="off" :spellcheck="false" class="min-h-8 w-full rounded-control border border-line bg-surface-soft px-3 text-sm" placeholder="填写服务商提供的完整模型 ID" @input="update({ model: ($event.target as HTMLInputElement).value })" />
        </div>
        <div class="space-y-2">
          <label for="provider-use-key" class="flex items-center gap-2 text-xs"><input id="provider-use-key" v-model="useKeyRef" name="useKey" type="checkbox" class="accent-brand" @change="testRef = null; errorRef = ''; noticeRef = ''" />使用 API Key</label>
          <template v-if="useKeyRef">
            <label for="provider-key" class="block text-xs text-ink-secondary">API Key <span v-if="configRef.credential" class="text-ink-muted">· 已保存在系统凭据库，留空保留</span></label>
            <div class="flex gap-2"><input id="provider-key" v-model="secretRef" aria-describedby="provider-key-help" name="apiKey" :type="showKeyRef ? 'text' : 'password'" :required="!configRef.credential" maxlength="2000" autocomplete="new-password" autocapitalize="off" autocorrect="off" :spellcheck="false" class="min-h-8 min-w-0 flex-1 rounded-control border border-line bg-surface-soft px-3 text-sm" @input="testRef = null; errorRef = ''; noticeRef = ''" /><AppButton variant="ghost" :aria-label="showKeyRef ? '隐藏 API Key' : '显示 API Key'" :aria-pressed="showKeyRef" @click="showKeyRef = !showKeyRef"><EyeOff v-if="showKeyRef" :size="15" /><Eye v-else :size="15" /></AppButton></div>
            <p id="provider-key-help" class="text-xs leading-5 text-ink-muted">macOS 首次读取或软件更新后可能请求钥匙串授权，这是读取已保存的模型密钥。同一会话只读取一次；取消后不会反复弹窗，可重新填写 Key 并保存。</p>
          </template>
        </div>
        <div><label for="provider-timeout" class="mb-1.5 block text-xs text-ink-secondary">单次请求超时（秒）</label><input id="provider-timeout" name="timeoutSeconds" :value="configRef.timeoutSeconds" type="number" required min="5" max="120" step="1" class="min-h-8 w-24 rounded-control border border-line bg-surface-soft px-3 text-sm" @input="update({ timeoutSeconds: Number(($event.target as HTMLInputElement).value) })" /></div>
        <div><label for="provider-thinking" class="mb-1.5 block text-xs text-ink-secondary">思考模式（支持 thinking 参数的接口）</label><select id="provider-thinking" name="thinking" :value="configRef.thinking == null ? 'default' : configRef.thinking ? 'enabled' : 'disabled'" aria-describedby="provider-thinking-help" class="min-h-8 w-full rounded-control border border-line bg-surface-soft px-3 text-sm" @change="update({ thinking: ($event.target as HTMLSelectElement).value === 'default' ? null : ($event.target as HTMLSelectElement).value === 'enabled' })"><option value="default">服务默认</option><option value="disabled">关闭思考</option><option value="enabled">开启思考</option></select><p id="provider-thinking-help" class="mt-1 text-xs leading-5 text-ink-muted">DeepSeek 等接口可关闭思考以减少逐页等待。不支持此参数的接口请保持「服务默认」。更改模型后恢复默认。</p></div>
        <div class="rounded-control bg-surface-soft p-3">
          <label for="provider-consent" class="flex items-start gap-2 text-xs leading-5"><input id="provider-consent" name="allowScreenshots" :checked="configRef.allowScreenshots" type="checkbox" class="mt-1 accent-brand" @change="update({ allowScreenshots: ($event.target as HTMLInputElement).checked })" /><span>允许视觉工作流向 <strong class="font-medium text-ink">{{ destinationRef }}</strong> 发送手机截图（可能包含昵称、会话和消息）。修改接口地址后需重新勾选。</span></label>
          <p class="mt-2 text-xs leading-5 text-ink-muted">仅主动选择视觉模式的工作流会发送截图。模型只识别页面；接收对象和文字来自你的配置。此全局设置也会用于后续定时运行。</p>
        </div>
      </fieldset>
      <p v-if="errorRef" role="alert" class="rounded-control bg-danger-soft px-3 py-2 text-xs leading-5 text-danger wrap-anywhere">{{ errorRef }}</p>
      <p v-if="testRef" role="status" class="rounded-control bg-success-soft px-3 py-2 text-xs leading-5 text-success">{{ testRef.message }} · {{ testRef.elapsedMs }} ms</p>
      <p v-if="noticeRef" role="status" class="text-xs leading-5 text-success">{{ noticeRef }}</p>
      <div class="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3"><p class="text-xs leading-5 text-ink-muted">测试仅使用固定色块图，不读取手机。<br />中文输入时会短暂打开已安装的 AutoJs6，无需开启无障碍。</p><div class="flex gap-2"><AppButton variant="secondary" :disabled="busyRef || !loadedRef" @click="action(true)"><FlaskConical :size="14" />测试连接</AppButton><button type="submit" :disabled="busyRef || !loadedRef" class="inline-flex min-h-8 items-center gap-2 rounded-control bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-45"><Save :size="14" />{{ busyRef ? '处理中…' : '保存设置' }}</button></div></div>
    </form>
  </section>
</template>
