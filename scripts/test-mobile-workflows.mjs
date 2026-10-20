import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import { mobileWechatDefinitions } from './mobile-scripts.mjs';

const require = createRequire(import.meta.url);
const modules = new Map();
function loadMobile(path) {
  if (modules.has(path)) return modules.get(path).exports;
  const module = { exports: {} }; modules.set(path, module);
  const execute = vm.runInThisContext('(function(require,module,exports){' + readFileSync(path, 'utf8') + '\n})', { filename: path });
  execute(specifier => loadMobile(createRequire(path).resolve(specifier)), module, module.exports);
  return module.exports;
}
const mobilePath = fileURLToPath(new URL('../mobile-workflows/wechat-suite/src/', import.meta.url));
const core = loadMobile(mobilePath + 'core.js');
const http = loadMobile(mobilePath + 'request.js');
const definitions = loadMobile(mobilePath + 'definitions.js');
const markers = loadMobile(mobilePath + 'markers.js');
const provider = loadMobile(mobilePath + 'provider.js');
const workflow = id => definitions.workflows.find(w => w.id === id);
const pair = (role, text, point, value = null) => ({ role, text, point, value, complete: true });
const request = (response = { type: 'text' }) => ({ url: 'https://example.invalid/message', method: 'GET', query: [], headers: [], auth: { type: 'none' }, body: null, response, timeoutSeconds: 20 });
const input = (message = { type: 'manual', text: 'Ok' }, names = ['群甲', '群乙']) => ({ message, recipients: { scope: 'groups', mode: 'selected', names }, intervalMs: 1000 });

function fixture({ existingDraft = '', uncertain = false, targets = ['群甲', '群乙'] } = {}) {
  const state = { page: 'me', pageIndex: 0, query: '', title: '', draft: existingDraft, outgoing: [], sendClicks: 0, requests: [], records: [], typed: [], clears: 0, logs: [] };
  const tabs = ['微信', '通讯录', '发现', '我'].map((t, i) => pair('tab', t, [125 + i * 250, 950]));
  function observe() {
    const rows = role => targets.slice(state.pageIndex * 20, state.pageIndex * 20 + 20).map((name, index) => pair(role, name, [500, 220 + index * 30]));
    const s = { page: state.page, title: '', certain: true, items: [], editor: null, outgoing: [], listEmpty: false };
    if (s.page === 'home') s.items = [...tabs, pair('search', '', [850, 50]), pair('more', '', [950, 50]), ...rows('chat')];
    else if (s.page === 'me') s.items = [...tabs, pair('profile', '本地测试 微信号：tester', [500, 150])];
    else if (s.page === 'profile') { s.title = '个人信息'; s.items = [pair('row', '昵称', [500, 220], '本地测试')]; }
    else if (s.page === 'search') { s.items = [pair('search_input', '搜索', [500, 80], state.query)]; if (state.query) s.items.push(pair('chat', state.query, [500, 250])); }
    else if (s.page === 'other') { s.title = '微信菜单'; s.items = [pair('new_chat', '发起群聊', [700, 150])]; }
    else if (s.page === 'new_chat') s.items = [pair('choose_group', '选择一个已有的群', [500, 150])];
    else if (s.page === 'groups') s.items = rows('group');
    else if (s.page === 'chat') { s.title = state.title; s.editor = { point: [500, 900], text: state.draft }; s.outgoing = state.outgoing; if (state.draft) s.items.push(pair('send', '发送', [900, 900])); }
    return structuredClone(s);
  }
  const io = {
    runId: 'test', now: () => 123, sleep() {}, wake() {}, launch() {},
    scroll(up) { state.pageIndex = Math.max(0, Math.min(Math.ceil(targets.length / 20) - 1, state.pageIndex + (up ? -1 : 1))); },
    observe, back() { state.page = 'home'; },
    beforeCommit() {},
    openRow(title, page) {
      assert.equal(state.page, page);
      const matches = observe().items.filter(i => ['chat', 'group'].includes(i.role) && i.text === title);
      assert.equal(matches.length, 1); io.click(matches[0].point);
    },
    click(point) {
      const item = observe().items.find(i => String(i.point) === String(point));
      assert.ok(item, 'Unknown click ' + point + ' on ' + state.page);
      if (item.role === 'tab') state.page = item.text === '我' ? 'me' : 'home';
      else if (item.role === 'profile') state.page = 'profile';
      else if (item.role === 'search') { state.query = ''; state.page = 'search'; }
      else if (item.role === 'more') state.page = 'other';
      else if (item.role === 'new_chat') state.page = 'new_chat';
      else if (item.role === 'choose_group') state.page = 'groups';
      else if (['chat', 'group'].includes(item.role)) { state.title = item.text; state.page = 'chat'; }
      else if (item.role === 'send') {
        state.sendClicks++;
        if (uncertain) throw Error('connection lost after click');
        state.outgoing.push({ text: state.draft, failed: false, pending: false }); state.draft = '';
      }
    },
    type(value) {
      if (state.page === 'search') state.query = value;
      else { assert.equal(state.page, 'chat'); assert.equal(state.draft, ''); state.draft = value; state.typed.push(value); }
    },
    clear(value) { assert.equal(state.draft, value); state.draft = ''; state.clears++; },
    record(value) { state.records.push(structuredClone(value)); },
    log(type, details) { state.logs.push({ type, details }); },
    parseUrl(value) { const u = new URL(value); return { scheme: u.protocol.slice(0, -1), host: u.hostname, username: u.username, password: u.password, fragment: u.hash }; },
    secret(id, endpoint) { assert.equal(id, '11111111-1111-4111-8111-111111111111'); assert.equal(endpoint, 'https://example.invalid/message'); return 'private-fixture-value'; },
    base64: value => Buffer.from(value).toString('base64'),
    request(value) { state.requests.push(structuredClone(value)); return { status: 200, body: 'fresh-' + state.requests.length }; },
  };
  return { io, state, runner: core.create(io) };
}

test('mobile bundle contains the five exact desktop workflow definitions and observation contract', async () => {
  assert.equal(await readFile(new URL('../mobile-workflows/wechat-suite/src/definitions.js', import.meta.url), 'utf8'), await mobileWechatDefinitions());
  assert.equal(definitions.workflows.length, 5);
  for (const mobile of definitions.workflows) assert.deepEqual(mobile, JSON.parse(await readFile(new URL('../workflows/' + mobile.id + '/workflow.json', import.meta.url), 'utf8')));
});

test('all five workflows run through the mobile controller; rehearsal clears its draft and never sends', () => {
  for (const id of ['wechat-open', 'wechat-nickname', 'wechat-first-chat', 'wechat-send-hello', 'wechat-broadcast']) {
    const { runner, state } = fixture();
    const result = runner.run(workflow(id), { dryRun: true, input: input(), hooks: {} });
    assert.equal(state.records.at(-1).status, 'completed'); assert.equal(state.sendClicks, 0);
    assert.equal(state.records.at(-1).workflowVersion, workflow(id).version);
    if (id === 'wechat-nickname') assert.equal(result.nickname, '本地测试');
    if (id === 'wechat-send-hello') { assert.deepEqual(state.typed, ['1']); assert.equal(state.clears, 1); }
    if (id === 'wechat-broadcast') { assert.deepEqual(state.typed, ['Ok', 'Ok']); assert.ok(state.records.at(-1).targets.every(t => t.status === 'rehearsed')); }
  }
});

test('all groups and all homepage conversations are enumerated before rehearsal', () => {
  for (const scope of ['groups', 'conversations']) {
    const { runner, state } = fixture();
    const value = input(); value.recipients = { scope, mode: 'all', names: [] };
    runner.run(workflow('wechat-broadcast'), { dryRun: true, input: value });
    assert.deepEqual(state.records.at(-1).targets.map(t => t.title), ['群甲', '群乙']); assert.equal(state.sendClicks, 0);
  }
});

test('HTTP freshness is once per run or per recipient; lifecycle receives rehearsal and completed context', () => {
  for (const refresh of ['run', 'recipient']) {
    const { runner, state, io } = fixture();
    const sendRequest = io.request;
    io.request = value => { assert.equal(state.page, refresh === 'recipient' ? 'chat' : 'home'); return sendRequest(value); };
    runner.run(workflow('wechat-broadcast'), { dryRun: true, input: input({ type: 'http', request: request(), refresh }) });
    assert.equal(state.requests.length, refresh === 'run' ? 1 : 2);
    assert.deepEqual(state.typed, refresh === 'run' ? ['fresh-1', 'fresh-1'] : ['fresh-1', 'fresh-2']);
  }
  const { runner, state } = fixture();
  const after = request({ type: 'ignore' }); after.method = 'POST'; after.body = { mode: '{{run.mode}}', status: '{{run.status}}', completed: '{{result.completed}}' };
  runner.run(workflow('wechat-broadcast'), { dryRun: true, input: input({ type: 'before_run' }), hooks: { beforeRun: request(), afterRun: after } });
  assert.deepEqual(state.typed, ['fresh-1', 'fresh-1']);
  assert.deepEqual(state.requests[1].body, { mode: 'rehearsal', status: 'completed', completed: '2' });
});

test('existing drafts are preserved; uncertain send stops the batch without replay', () => {
  const draft = fixture({ existingDraft: '客户原草稿' });
  assert.throws(() => draft.runner.run(workflow('wechat-send-hello'), { dryRun: true }), /已有草稿/);
  assert.equal(draft.state.draft, '客户原草稿'); assert.equal(draft.state.sendClicks, 0);
  const same = fixture({ existingDraft: '1' });
  same.runner.run(workflow('wechat-send-hello'), { dryRun: true });
  assert.equal(same.state.draft, '1'); assert.equal(same.state.clears, 0);
  const send = fixture({ uncertain: true });
  assert.throws(() => send.runner.run(workflow('wechat-broadcast'), { dryRun: false, input: input() }), /connection lost/);
  assert.equal(send.state.sendClicks, 1); assert.deepEqual(send.state.records.at(-1).targets.map(t => t.status), ['uncertain', 'skipped']);
  const changed = fixture();
  changed.io.beforeCommit = () => { throw Error('screen changed'); };
  assert.throws(() => changed.runner.run(workflow('wechat-send-hello'), { dryRun: false }), /screen changed/);
  assert.equal(changed.state.sendClicks, 0); assert.equal(changed.state.draft, '1');
});

test('1000 selected conversations preserve durable progress and receive the latest HTTP message', () => {
  const names = Array.from({ length: 1000 }, (_, i) => '会话' + (i + 1));
  const { runner, state, io } = fixture({ targets: names });
  io.record = value => { state.last = structuredClone(value); };
  const value = input({ type: 'http', request: request(), refresh: 'recipient' }, names);
  value.recipients.scope = 'conversations';
  runner.run(workflow('wechat-broadcast'), { dryRun: true, input: value });
  assert.equal(state.requests.length, 1000); assert.equal(state.typed.length, 1000);
  assert.equal(state.typed[999], 'fresh-1000'); assert.equal(state.clears, 1000); assert.equal(state.sendClicks, 0);
  assert.equal(state.last.targets.length, 1000); assert.ok(state.last.targets.every(t => t.status === 'rehearsed'));
});

test('request parsing, data variables and auth modes enforce boundaries without retries', () => {
  const { io, state } = fixture(), credential = '11111111-1111-4111-8111-111111111111';
  for (const auth of [{ type: 'none' }, { type: 'bearer', credential }, { type: 'basic', username: 'user', credential }, { type: 'api_key', name: 'X-Key', location: 'header', credential }, { type: 'api_key', name: 'key', location: 'query', credential }]) {
    const spec = request({ type: 'json', pointer: '/data/a~1b' }); spec.auth = auth; spec.method = 'POST';
    spec.query = [{ name: 'who', value: '{{recipient.title}}' }]; spec.headers = [{ name: 'X-Run', value: '{{run.id}}' }]; spec.body = { mode: '{{run.mode}}' };
    io.request = value => { state.requests.push(value); return { status: 200, body: '{"data":{"a/b":"你好"}}' }; };
    assert.equal(http.fetch(spec, { recipient: { title: '测试群' }, run: { id: 'abc', mode: 'rehearsal' } }, io).message, '你好');
    const actual = state.requests.at(-1);
    assert.equal(actual.query[0].value, '测试群'); assert.equal(actual.headers[0].value, 'abc'); assert.equal(actual.body.mode, 'rehearsal');
    if (auth.type === 'bearer') assert.equal(actual.headers[1].value, 'Bearer private-fixture-value');
    if (auth.type === 'basic') assert.equal(actual.headers[1].value, 'Basic ' + Buffer.from('user:private-fixture-value').toString('base64'));
    if (auth.type === 'api_key') assert.equal((auth.location === 'query' ? actual.query : actual.headers)[1].value, 'private-fixture-value');
  }
  assert.throws(() => http.expand('{{missing}}', {}), /当前时机/);
  assert.throws(() => http.expand('{{run.id', {}), /括号/);
  for (const bad of ['http://example.com', 'https://user:password@example.com']) assert.throws(() => http.validate({ ...request(), url: bad }, io), /地址/);
  assert.throws(() => http.pointer({}, '/missing'), /找不到/); assert.throws(() => http.pointer({}, '/bad~2path'), /路径/);
  const preview = http.preview(request({ type: 'json', pointer: '/missing' }), {}, io);
  assert.match(preview.parseError, /找不到/); assert.equal(preview.raw, '{"data":{"a/b":"你好"}}');
  assert.throws(() => http.fetch(request({ type: 'json', pointer: '/missing' }), {}, io), /找不到/);
  const before = state.requests.length; io.request = () => { state.requests.push({}); return { status: 429, body: 'secret details' }; };
  assert.throws(() => http.fetch(request(), {}, io), /HTTP 429/); assert.equal(state.requests.length - before, 1);
});

test('malformed observations and ambiguous names stop before any click', () => {
  const { io } = fixture(), valid = io.observe();
  assert.throws(() => core.validateScreen({ ...valid, certain: false }), /识别不完整/);
  assert.throws(() => core.validateScreen({ ...valid, items: [pair('group', '群甲', [500, 1280])] }), /格式/);
  assert.throws(() => core.validateScreen({ ...valid, page: 'chat', title: '' }), /识别不完整/);
  assert.throws(() => core.validateInput(input({ type: 'manual', text: 'Ok' }, ['群甲', '群 甲'])), /重复/);
  assert.throws(() => core.mergeNames(['甲', '乙'], ['甲', '丙']), /顺序/);
});

test('a notification hiding the title is reread before any action, with bounded waiting and no network retries', () => {
  const { io, state } = fixture();
  const originalObserve = io.observe, originalClick = io.click;
  let reads = 0;
  io.observe = () => ++reads <= 2 ? { ...originalObserve(), page: 'chat', title: '' } : originalObserve();
  io.click = p => { assert.ok(reads > 2); originalClick(p); };
  core.create(io).run(workflow('wechat-first-chat'), { dryRun: true });
  assert.equal(state.logs.filter(l => l.type === 'observation_wait').length, 2);
  reads = 0; io.click = () => assert.fail('an obscured screen must never be clicked');
  io.observe = () => { reads++; return { ...originalObserve(), certain: false }; };
  assert.throws(() => core.create(io).run(workflow('wechat-first-chat'), { dryRun: true }), /识别不完整/);
  assert.equal(reads, 3);
  reads = 0; io.observe = () => { reads++; throw new Error('HTTP 429'); };
  assert.throws(() => core.create(io).run(workflow('wechat-first-chat'), { dryRun: true }), /HTTP 429/);
  assert.equal(reads, 1);
});

test('phone avatar labels and stale-screen guards match the desktop geometry and reject invented marker IDs', () => {
  const width = 400, height = 800;
  const image = new Uint32Array(width * height).fill(0xff1a1a1a);
  for (const top of [150, 250]) for (let y = top; y < top + 40; y++) for (let x = 18; x < 52; x++) image[y * width + x] = 0xff00c864;
  const points = markers.detect(image, width, height);
  assert.deepEqual(points, { 31: [87, 212], 68: [87, 337] });
  assert.deepEqual(markers.selected({ found: true, marker: 31, text: '群甲' }, points, '群甲'), [87, 212]);
  for (const marker of [null, '31', 999]) assert.throws(() => markers.selected({ found: true, marker, text: '群甲' }, points, '群甲'), /唯一对应/);
  assert.throws(() => markers.selected({ found: true, marker: 31, text: '群乙' }, points, '群甲'), /唯一对应/);
  const digitRows = new Set();
  markers.draw({ 31: points[31] }, width, height, (_x, y, _w, h, color) => {
    if (color === 0xffffffff) for (let row = y; row < y + h; row++) digitRows.add(row);
  });
  assert.ok(digitRows.size >= width * .06, 'avatar label digits must remain legible when the provider scales a tall screenshot');
  const caret = image.slice();
  for (let y = 710; y < 730; y++) caret[y * width + 100] = 0xffffffff;
  assert.equal(markers.unchanged(image, caret, width, height, [500, 900], true), true);
  caret[720 * width + 120] = 0xffffffff;
  assert.equal(markers.unchanged(image, caret, width, height, [500, 900], true), false);
  const title = image.slice(); title[70 * width + 100] = 0xffffffff;
  assert.equal(markers.unchanged(image, title, width, height, [500, 900], true), false);
});

test('explicit text-only image providers are rejected while absent capability metadata stays unknown', () => {
  const value = { data: [
    { id: 'text', modalities: { input: ['text'] } },
    { id: 'vision', modalities: { input: ['text', 'image'] } },
    { id: 'unknown' },
  ] };
  assert.equal(provider.imageSupport(value, 'text'), false);
  assert.equal(provider.imageSupport(value, 'vision'), true);
  assert.equal(provider.imageSupport(value, 'unknown'), null);
  assert.equal(provider.imageSupport(value, 'missing'), null);
});
