import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';
import * as vue from 'vue';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { parse, compileScript } = require('vue/compiler-sfc');
const filename = fileURLToPath(new URL('../src/components/HttpRequestEditor.vue', import.meta.url));
const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename });
const compiled = compileScript(descriptor, { id: 'http-editor-test' });
const javascript = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture() {
  const modelRef = vue.shallowRef({ url: 'https://original.example/message', method: 'GET', query: [], headers: [], auth: { type: 'bearer', credential: 'saved-credential-reference' }, body: null, response: { type: 'text' }, timeoutSeconds: 20 });
  const secretRef = vue.ref('newly-entered-value');
  const events = [];
  const props = { get modelValue() { return modelRef.value; }, get secret() { return secretRef.value; }, scope: 'http-test', callback: false };
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + javascript + '\n})')(name => name === 'vue' ? vue : name === '@tauri-apps/api/core' ? { isTauri: () => false, invoke: () => { throw Error('unexpected request'); } } : {}, module, module.exports);
  const scope = vue.effectScope();
  const api = scope.run(() => module.exports.default.setup(props, { expose() {}, emit(name, value) {
    events.push({ name, value });
    if (name === 'update:modelValue') modelRef.value = value;
    if (name === 'update:secret') secretRef.value = value;
  } }));
  return { api, modelRef, secretRef, events, close: () => scope.stop() };
}

test('changing the HTTP address clears stored and newly typed auth values without touching other settings', () => {
  const { api, modelRef, secretRef, close } = fixture();
  try {
    api.change({ url: 'https://new.example/message' });
    assert.equal(modelRef.value.auth.credential, '');
    assert.equal(secretRef.value, '');
    assert.equal(modelRef.value.auth.type, 'bearer');
    assert.equal(modelRef.value.response.type, 'text');
  } finally { close(); }
});

test('editing parameters or reapplying the same address preserves existing auth', () => {
  const { api, modelRef, secretRef, close } = fixture();
  try {
    api.change({ url: modelRef.value.url }); api.change({ timeoutSeconds: 10 });
    assert.equal(modelRef.value.auth.credential, 'saved-credential-reference');
    assert.equal(secretRef.value, 'newly-entered-value');
  } finally { close(); }
});
