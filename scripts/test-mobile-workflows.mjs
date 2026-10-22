import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import test from 'node:test';
import { buildMobileCatalog } from './mobile-scripts.mjs';

const require = createRequire(import.meta.url);
const modules = new Map();

function loadMobile(path) {
  if (modules.has(path)) return modules.get(path).exports;
  const module = { exports: {} };
  modules.set(path, module);
  const execute = vm.runInThisContext(
    '(function(require,module,exports){' + readFileSync(path, 'utf8') + '\n})',
    { filename: path },
  );
  execute(
    specifier => loadMobile(createRequire(path).resolve(specifier)),
    module,
    module.exports,
  );
  return module.exports;
}

const sharedPath = fileURLToPath(
  new URL('../mobile-workflows/shared/src/', import.meta.url),
);
const wecomPath = fileURLToPath(
  new URL('../mobile-workflows/wecom-suite/src/', import.meta.url),
);
const core = loadMobile(sharedPath + 'core.js');
const http = loadMobile(sharedPath + 'request.js');
const definitions = loadMobile(wecomPath + 'definitions.js');
const workflow = id => definitions.workflows.find(item => item.id === id);

const pair = (role, text, point, value = null) => ({
  role,
  text,
  point,
  value,
  complete: true,
});

const request = (response = { type: 'text' }) => ({
  url: 'https://example.invalid/message',
  method: 'GET',
  query: [],
  headers: [],
  auth: { type: 'none' },
  body: null,
  response,
  timeoutSeconds: 20,
});

const input = (
  message = { type: 'manual', text: 'Ok' },
  recipients = { groups: true, direct: false },
) => ({
  message,
  recipients,
  intervalMs: 1000,
});

function fixture({
  existingDraft = '',
  uncertain = false,
  groups = ['群甲', '群乙'],
  conversations = ['小王', '小李'],
} = {}) {
  const state = {
    page: 'home',
    previousPage: 'home',
    pageIndex: 0,
    title: '',
    draft: existingDraft,
    outgoing: [],
    sendClicks: 0,
    requests: [],
    records: [],
    typed: [],
    opened: [],
    clears: 0,
    logs: [],
  };

  function rows(role) {
    const values = state.page === 'groups' ? groups : conversations;
    return values
      .slice(state.pageIndex * 20, state.pageIndex * 20 + 20)
      .map((name, index) => pair(role, name, [500, 220 + index * 30]));
  }

  function observe() {
    const screen = {
      page: state.page,
      title: '',
      certain: true,
      items: [],
      editor: null,
      outgoing: [],
      listEmpty: false,
    };
    if (screen.page === 'home') screen.items = rows('chat');
    else if (screen.page === 'groups') {
      screen.title = '选择一个群';
      screen.items = rows('group');
    } else if (screen.page === 'chat') {
      screen.title = state.title;
      screen.editor = { point: [500, 900], text: state.draft };
      screen.outgoing = state.outgoing;
      if (state.draft) screen.items.push(pair('send', '发送', [900, 900]));
    }
    if (screen.page === 'home' || screen.page === 'groups')
      screen.listEmpty = !screen.items.length;
    return structuredClone(screen);
  }

  const io = {
    package: 'com.tencent.wework',
    runId: 'test',
    serial: 'fixture',
    now: () => 123,
    sleep() {},
    wake() {},
    launch() {},
    prepare() {},
    finish() {},
    requireAccessibility() {},
    focusedPackage: () => 'com.tencent.wework',
    home() {
      state.page = 'home';
      state.pageIndex = 0;
      return observe();
    },
    recipientPage(scope) {
      state.page = scope === 'groups' ? 'groups' : 'home';
      state.pageIndex = 0;
      return observe();
    },
    scroll(up) {
      if (!['home', 'groups'].includes(state.page)) return;
      const list = state.page === 'groups' ? groups : conversations;
      const previous = state.pageIndex;
      state.pageIndex = Math.max(
        0,
        Math.min(
          Math.ceil(list.length / 20) - 1,
          state.pageIndex + (up ? -1 : 1),
        ),
      );
      return state.pageIndex !== previous;
    },
    observe,
    back() {
      state.page = state.previousPage;
      state.previousPage = 'home';
    },
    beforeCommit() {},
    openRow(title, page) {
      assert.equal(state.page, page);
      state.opened.push(title);
      const matches = observe().items.filter(
        item => ['chat', 'group'].includes(item.role) && item.text === title,
      );
      assert.equal(matches.length, 1);
      io.click(matches[0].point);
    },
    click(point) {
      const item = observe().items.find(
        candidate => String(candidate.point) === String(point),
      );
      assert.ok(item, `Unknown click ${point} on ${state.page}`);
      if (['chat', 'group'].includes(item.role)) {
        state.previousPage = state.page;
        state.title = item.text;
        state.page = 'chat';
      } else if (item.role === 'send') {
        state.sendClicks++;
        if (uncertain) throw Error('connection lost after click');
        state.outgoing.push({
          text: state.draft,
          failed: false,
          pending: false,
        });
        state.draft = '';
      }
    },
    nickname: () => '测试姓名',
    type(value) {
      assert.equal(state.page, 'chat');
      assert.equal(state.draft, '');
      state.draft = value;
      state.typed.push(value);
    },
    clear(value) {
      assert.equal(state.draft, value);
      state.draft = '';
      state.clears++;
    },
    record(value) {
      state.records.push(structuredClone(value));
    },
    log(type, details) {
      state.logs.push({ type, details });
    },
    parseUrl(value) {
      const url = new URL(value);
      return {
        scheme: url.protocol.slice(0, -1),
        host: url.hostname,
        username: url.username,
        password: url.password,
        fragment: url.hash,
      };
    },
    secret(id, endpoint) {
      assert.equal(id, '11111111-1111-4111-8111-111111111111');
      assert.equal(endpoint, 'https://example.invalid/message');
      return 'private-fixture-value';
    },
    base64: value => Buffer.from(value).toString('base64'),
    request(value) {
      state.requests.push(structuredClone(value));
      return { status: 200, body: 'fresh-' + state.requests.length };
    },
    evaluateResponse: source => vm.runInNewContext(source, {}, { timeout: 1000 }),
  };
  return { io, state, runner: core.create(io) };
}

test('mobile catalog publishes only the harmless demo and WeCom package', async () => {
  const { catalog } = await buildMobileCatalog();
  assert.deepEqual(
    catalog.workflows.map(item => item.id),
    ['demo-hello', 'wecom-suite'],
  );
  assert.deepEqual(
    definitions.workflows.map(item => item.id),
    ['wecom-open', 'wecom-nickname', 'wecom-first-chat', 'wecom-broadcast'],
  );
  for (const item of definitions.workflows) {
    assert.deepEqual(
      item,
      JSON.parse(
        await readFile(
          new URL(`../workflows/${item.id}/workflow.json`, import.meta.url),
          'utf8',
        ),
      ),
    );
  }
});

test('published WeCom package has no screenshot or image-model path', async () => {
  const { catalog } = await buildMobileCatalog();
  const pack = catalog.workflows.find(item => item.id === 'wecom-suite');
  assert.ok(pack);
  for (const file of pack.files) {
    const bytes = await readFile(
      new URL(`../mobile-workflows/wecom-suite/src/${file.path}`, import.meta.url),
    );
    assert.equal(bytes.length, file.size);
  }
  for (const name of ['core.js', 'io.js', 'main.js', 'wecom.js']) {
    const source = readFileSync(wecomPath + name, 'utf8');
    assert.doesNotMatch(
      source,
      /requestScreenCapture|chat\/completions|allowScreenshots|images\.captureScreen/,
    );
  }
});

test('all four WeCom workflows run in rehearsal and never click send', () => {
  for (const item of definitions.workflows) {
    const { runner, state } = fixture();
    const result = runner.run(item, {
      dryRun: true,
      hooks: {},
      input: input(),
    });
    assert.equal(state.records.at(-1).status, 'completed');
    assert.equal(state.sendClicks, 0);
    assert.equal(state.records.at(-1).workflowVersion, item.version);
    if (item.id === 'wecom-nickname') assert.equal(result.nickname, '测试姓名');
  }
});

test('slow observations, chat transitions, input and clearing wait without replaying writes', () => {
  const { runner, state, io } = fixture({ groups: ['群甲'] });
  let reads = 0, opening = 0, typing = 0, clearing = 0;
  const observe = io.observe;
  io.observe = () => {
    const screen = observe();
    if (++reads <= 30) screen.certain = false;
    else if (state.page === 'chat' && !state.typed.length && ++opening <= 30) screen.page = state.previousPage;
    else if (state.draft && state.typed.length && ++typing <= 30) screen.editor.text = '';
    else if (state.clears && ++clearing <= 30) screen.editor.text = 'Ok';
    return screen;
  };
  assert.equal(runner.observe().page, 'home');
  runner.run(workflow('wecom-broadcast'), { dryRun: true, input: input() });
  assert.ok(opening > 30 && typing > 30 && clearing > 30);
  assert.deepEqual(state.typed, ['Ok']);
  assert.equal(state.clears, 1);
  assert.equal(state.sendClicks, 0);
  assert.equal(state.records.at(-1).status, 'completed');
});

test('waiting for a stalled page still honors a manual stop', () => {
  const { runner, io } = fixture();
  const observe = io.observe;
  let waits = 0;
  io.observe = () => ({ ...observe(), certain: false });
  io.sleep = () => { if (++waits === 30) throw Error('用户停止'); };
  assert.throws(() => runner.observe(), /用户停止/);
  assert.equal(waits, 30);
});

test('native launch leaves the shade or recents through Home and waits for the app', () => {
  for (const sdk of [28, 35]) {
    const commands = [];
    let reads = 0, waits = 0, cancel = false;
    const io = { requireAccessibility() {}, focusedPackage: () => ++reads > 40 ? 'com.tencent.wework' : 'com.android.systemui' };
    const module = { exports: {} };
    const execute = vm.runInNewContext('(function(require,module){' + readFileSync(wecomPath + 'wecom.js', 'utf8') + '\n})', {
      context: {
        getPackageManager: () => ({ getPackageInfo: () => ({ versionName: '5.0.12' }) }),
        getSystemService: () => ({ isKeyguardLocked: () => false }),
      },
      android: {
        os: { Build: { VERSION: { SDK_INT: sdk } } },
        content: { Context: { KEYGUARD_SERVICE: 'keyguard' } },
        accessibilityservice: { AccessibilityService: { GLOBAL_ACTION_HOME: 2, GLOBAL_ACTION_DISMISS_NOTIFICATION_SHADE: 15 } },
        view: { accessibility: { AccessibilityNodeInfo: {} } },
      },
      auto: { service: { performGlobalAction(action) { commands.push(action); return true; } } },
      back() { commands.push('back'); return true; },
      sleep() { if (cancel) throw Error('用户停止'); waits++; },
      app: { launchPackage(name) { commands.push(name); return true; } },
    });
    execute(name => name === './io.js' ? () => io : { profile: () => ({}) }, module);
    const native = module.exports.create({}, {});
    native.launch();
    assert.deepEqual(commands, [sdk >= 31 ? 15 : 'back', 2, 'com.tencent.wework']);
    assert.equal(reads, 41);
    assert.equal(waits, 41);
    cancel = true;
    assert.throws(() => native.launch(), /用户停止/);
  }
});

test('duplicate send actions fail before hooks or device IO', () => {
  const invalid = structuredClone(workflow('wecom-broadcast'));
  invalid.steps.push({ id: 'again', name: 'Duplicate', action: { type: 'chat_broadcast' } });
  const { runner, state } = fixture();
  assert.throws(() => core.validateWorkflow(invalid), /一个发送动作/);
  assert.throws(() => runner.run(invalid, { dryRun: false, input: input(), hooks: { beforeRun: request() } }), /一个发送动作/);
  assert.equal(state.sendClicks, 0);
  assert.equal(state.requests.length, 0);
  assert.equal(state.typed.length, 0);
  assert.equal(state.logs.length, 0);
});

test('native titles reject digit removal, truncation and similar chat names', () => {
  const wecom = loadMobile(wecomPath + 'wecom.js');
  assert.equal(core.sameTitle('测试群(20)', '测试群'), true);
  for (const [actual, expected] of [
    ['123测试群', '测试群'],
    ['测试群2', '测试群'],
    ['销售…通知(20)', '销售A部门通知'],
    ['销售…通知(20)', '销售B部门通知'],
  ]) {
    assert.equal(core.sameTitle(actual, expected), false);
    assert.equal(wecom.exactDraft({ page: 'chat', title: actual, editor: { text: 'Ok' } }, expected, 'Ok'), false);
    const { runner, state, io } = fixture({ groups: [expected] });
    const observe = io.observe;
    io.observe = () => {
      const value = observe();
      if (value.page === 'chat') value.title = actual;
      return value;
    };
    assert.throws(() => runner.run(workflow('wecom-broadcast'), { dryRun: false, input: input() }), /目标会话/);
    assert.equal(state.typed.length, 0);
    assert.equal(state.sendClicks, 0);
  }
});

test('native outgoing messages require the unique right avatar in their own row', () => {
  const wecom = loadMobile(wecomPath + 'wecom.js');
  for (const [body, avatar, expected] of [
    [[650, 704, 921, 818], [936, 704, 1050, 818], 1],
    [[177, 704, 921, 921], [936, 704, 1050, 818], 1],
    [[159, 704, 450, 818], [30, 704, 144, 818], 0],
    [[159, 704, 903, 921], [30, 704, 144, 818], 0],
    [[177, 704, 921, 921], [936, 1000, 1050, 1114], 0],
  ]) {
    const nodes = [
      { id: 'message_row', parent: -1, position: 17, bounds: [0, 704, 1080, 921] },
      { id: 'i_d', parent: 0, bounds: body, text: 'Hello' },
      { id: 'message_avatar', parent: 0, bounds: avatar },
    ].map(node => ({ ...node, visible: true, enabled: true }));
    assert.equal(wecom.outgoing(nodes, 1080).length, expected);
    if (expected) assert.equal(wecom.outgoing(nodes, 1080)[0].position, 17);
    assert.equal(wecom.outgoing(nodes.slice(0, 2), 1080).length, 0);
    assert.equal(wecom.outgoing([...nodes, nodes[2]], 1080).length, 0);
  }
});

test('outgoing bubbles follow visible row order rather than tree traversal depth', () => {
  const wecom = loadMobile(wecomPath + 'wecom.js');
  const nodes = [
    { id: 'message_row', parent: -1, position: 18, bounds: [0, 1000, 1080, 1200] },
    { id: 'i_d', parent: 0, bounds: [177, 1000, 921, 1200], text: 'New' },
    { id: 'message_avatar', parent: 0, bounds: [936, 1000, 1050, 1114] },
    { id: 'message_row', parent: -1, position: 17, bounds: [0, 704, 1080, 921] },
    { id: 'i_d', parent: 3, bounds: [177, 704, 921, 921], text: 'Old' },
    { id: 'message_avatar', parent: 3, bounds: [936, 704, 1050, 818] },
  ].map(node => ({ ...node, visible: true, enabled: true }));
  assert.deepEqual(wecom.outgoing(nodes, 1080).map(b => [b.text, b.position]), [['Old', 17], ['New', 18]]);
});

test('real published entry loads its IO factory and decrypts legacy WeCom credentials', () => {
  const alias = 'com.por.autojs6.wechat.credentials.v1';
  const id = '11111111-1111-4111-8111-111111111111';
  const endpoint = 'https://example.invalid/message';
  const key = randomBytes(32), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(endpoint + '\n' + id));
  const encrypted = Buffer.concat([cipher.update('legacy-secret', 'utf8'), cipher.final(), cipher.getAuthTag()]);
  const saved = { [id]: { endpoint, iv: iv.toString('base64'), data: encrypted.toString('base64') } };
  let reads = 0, interrupts = 0, contextExits = 0, pending = false;
  function JavaString(value) { this.value = Buffer.isBuffer(value) ? value.toString('utf8') : String(value); }
  JavaString.prototype.getBytes = function () { return Buffer.from(this.value, 'utf8'); };
  JavaString.prototype.toString = function () { return this.value; };
  const globals = {
    Packages: { org: { mozilla: { javascript: { Context: {
      enter: () => ({
        setOptimizationLevel: value => assert.equal(value, -1),
        initSafeStandardObjects: () => vm.createContext({}),
        evaluateString(scope, source) {
          const value = vm.runInContext(source, scope, { timeout: 1000 });
          return typeof value === 'string' ? new JavaString(value) : value;
        },
      }),
      exit: () => contextExits++,
    } } } } },
    threads: { start(action) {
      if (!pending) action();
      return { join: ms => assert.equal(ms, 1000), isAlive: () => pending, interrupt: () => interrupts++ };
    } },
    java: {
      lang: { String: JavaString },
      util: { concurrent: { TimeUnit: {} } },
      security: { KeyStore: { getInstance: () => ({
        load() {},
        containsAlias: value => value === alias,
        getKey(value) { assert.equal(value, alias); reads++; return key; },
      }) } },
    },
    javax: { crypto: {
      spec: { GCMParameterSpec: function (_, value) { this.iv = value; } },
      Cipher: { DECRYPT_MODE: 2, getInstance: () => {
        let decipher;
        return {
          init(_, value, params) { decipher = createDecipheriv('aes-256-gcm', value, params.iv); },
          updateAAD(value) { decipher.setAAD(value); },
          doFinal(value) { decipher.setAuthTag(value.subarray(-16)); return Buffer.concat([decipher.update(value.subarray(0, -16)), decipher.final()]); },
        };
      } },
    } },
    android: {
      util: { Base64: { NO_WRAP: 2, decode: value => Buffer.from(value, 'base64') } },
      view: { accessibility: { AccessibilityNodeInfo: {} } },
    },
    context: {
      getPackageName: () => 'org.autojs.autojs6',
      getPackageManager: () => ({ getPackageInfo: () => ({ versionName: '5.0.12' }) }),
    },
    files: { exists: () => true, read: () => JSON.stringify(saved) },
    sleep() {},
    dialogs: { select: () => 7 },
  };
  const loaded = new Map();
  function load(path) {
    if (loaded.has(path)) return loaded.get(path).exports;
    const module = { exports: {} };
    loaded.set(path, module);
    const wrapper = vm.runInNewContext('(function(require,module,exports){' + readFileSync(path, 'utf8') + '\n})', globals, { filename: path });
    wrapper(specifier => load(createRequire(path).resolve(specifier)), module, module.exports);
    return module.exports;
  }
  const por = { dataDir: '/fixture', runId: 'fixture', readConfig: () => ({}), log() {} };
  const io = load(wecomPath + 'wecom.js').create(por, {});
  assert.equal(typeof io.observe, 'function');
  assert.equal(io.secret(id, endpoint), 'legacy-secret');
  assert.equal(reads, 1);
  assert.throws(() => io.secret(id, 'https://other.invalid'), /接口地址改变/);
  const publishedHttp = load(wecomPath + 'request.js');
  assert.equal(publishedHttp.parse('{"data":{"message":"你好"}}', { type: 'javascript', code: 'return res.data.message;' }, io), '你好');
  assert.equal(publishedHttp.parse('{}', { type: 'javascript', code: 'return [typeof java, typeof Packages, typeof files, typeof require].join(",");' }, io), 'undefined,undefined,undefined,undefined');
  assert.throws(() => publishedHttp.parse('{}', { type: 'javascript', code: 'return res;' }, io), /非空文字/);
  assert.equal(contextExits, 3);
  pending = true;
  assert.throws(() => io.evaluateResponse(''), /执行超时/);
  assert.equal(interrupts, 4);
  pending = false;
  load(wecomPath + 'main.js')(por);
  assert.throws(() => load(wecomPath + 'main.js')({ ...por, execution: { workflowId: 'invalid', dryRun: true } }), /无效/);
});

test('categorical recipients use their native lists in stable order and deduplicate groups', () => {
  for (const [recipients, expected] of [
    [
      { groups: true, direct: false },
      ['群甲', '群乙'],
    ],
    [
      { groups: false, direct: true },
      ['小王', '小李'],
    ],
    [
      { groups: true, direct: true },
      ['群甲', '群乙', '小王', '小李'],
    ],
  ]) {
    const { runner, state, io } = fixture();
    io.openNamed = () => {
      throw Error('categorical processing must not use global search');
    };
    runner.run(workflow('wecom-broadcast'), {
      dryRun: true,
      input: input(undefined, recipients),
    });
    assert.deepEqual(
      state.opened,
      expected,
    );
    assert.equal(state.typed.length, expected.length);
    assert.equal(state.sendClicks, 0);
  }
});

test('large group inventory is frozen once and never searched recipient by recipient', () => {
  const groups = Array.from({ length: 1000 }, (_, index) => `群聊${index + 1}`);
  const { runner, state, io } = fixture({ groups });
  let searches = 0;
  io.openNamed = () => {
    searches++;
  };
  runner.run(workflow('wecom-broadcast'), {
    dryRun: true,
    input: input(undefined, { groups: true, direct: false }),
  });
  assert.equal(searches, 0);
  assert.equal(state.typed.length, 1000);
  assert.equal(state.clears, 1000);
  assert.equal(state.sendClicks, 0);
  assert.equal(state.records.at(-1).targets.length, 0);
  assert.equal(state.records.at(-1).outputs.completed_count, '1000');
  assert.ok(state.records.length <= 3, 'rehearsal rewrote history for each recipient');
});

test('a frozen scroll waits for changed rows before confirming the full inventory', () => {
  const groups = Array.from({ length: 45 }, (_, index) => `群${index + 1}`);
  const { runner, state, io } = fixture({ groups });
  const scroll = io.scroll, observe = io.observe;
  let pending = null, reads = 0;
  io.scroll = up => {
    assert.equal(pending, null, 'a scroll was replayed while its page was still frozen');
    const previous = state.pageIndex, moved = scroll(up);
    if (moved) { pending = state.pageIndex; state.pageIndex = previous; reads = 0; }
    return moved;
  };
  io.observe = () => {
    if (pending !== null && ++reads >= 30) { state.pageIndex = pending; pending = null; }
    return observe();
  };
  assert.deepEqual(runner.discover('groups'), groups);
  assert.equal(state.sendClicks, 0);
});

test('sent readback survives an identical older message leaving the viewport', () => {
  const { io, state, runner } = fixture({ groups: ['群甲'] });
  const text = 'Ok';
  state.outgoing.push({ text, failed: false, pending: false, position: 7 });
  const observe = io.observe;
  io.observe = () => {
    const screen = observe();
    if (state.sendClicks) screen.outgoing = [{ ...screen.outgoing.at(-1), position: 8 }];
    return screen;
  };
  runner.run(workflow('wecom-broadcast'), {
    dryRun: false,
    input: input({ type: 'manual', text }),
  });
  assert.equal(state.sendClicks, 1);
  assert.equal(state.records.at(-1).outputs.completed_count, '1');
});

test('clearing the draft cannot acknowledge an unchanged old matching message', () => {
  for (const [position, revealOlder] of [[undefined, false], [7, false], [7, true]]) {
    const { io, state, runner } = fixture({ groups: ['群甲'] });
    const previous = { text: 'Ok', failed: false, pending: false, position };
    let waits = 0;
    io.sleep = () => { if (state.sendClicks && ++waits >= 20) throw Error('人工停止：发送结果不明'); };
    state.outgoing.push(previous);
    const observe = io.observe;
    io.observe = () => {
      const screen = observe();
      if (state.sendClicks) screen.outgoing = revealOlder ? [{ ...previous, position: 6 }, previous] : [previous];
      return screen;
    };
    assert.throws(() => runner.run(workflow('wecom-broadcast'), { dryRun: false, input: input() }), /发送结果不明/);
    assert.equal(state.sendClicks, 1);
    assert.equal(state.records.at(-1).targets[0].status, 'uncertain');
  }
});

test('a delayed outgoing bubble is re-read without clicking send again', () => {
  const { io, state, runner } = fixture({ groups: ['群甲'] });
  let readbacks = 0;
  const observe = io.observe;
  io.observe = () => {
    const screen = observe();
    if (state.sendClicks && ++readbacks < 40) screen.outgoing = [];
    return screen;
  };
  runner.run(workflow('wecom-broadcast'), { dryRun: false, input: input() });
  assert.equal(readbacks, 40);
  assert.equal(state.sendClicks, 1);
  assert.equal(state.records.at(-1).outputs.completed_count, '1');
});

test('sent readback still requires an empty editor and the latest confirmed outgoing body', () => {
  const matching = { text: 'Ok', failed: false, pending: false };
  for (const after of [
    { outgoing: [] },
    { outgoing: [matching], draft: 'Ok' },
    { outgoing: [matching, { ...matching, text: 'Other' }] },
    { outgoing: [{ ...matching, pending: true }] },
    { outgoing: [{ ...matching, failed: true }] },
    { outgoing: [matching], title: '其他群' },
  ]) {
    const { io, state, runner } = fixture({ groups: ['群甲', '群乙'] });
    let waits = 0;
    io.sleep = () => { if (state.sendClicks && ++waits >= 20) throw Error('人工停止：发送结果不明'); };
    const observe = io.observe;
    io.observe = () => {
      const screen = observe();
      if (state.sendClicks) {
        screen.outgoing = after.outgoing;
        if (after.draft) screen.editor.text = after.draft;
        if (after.title) screen.title = after.title;
      }
      return screen;
    };
    assert.throws(() => runner.run(workflow('wecom-broadcast'), {
      dryRun: false,
      input: input(),
    }), /发送结果不明|目标会话|发送失败/);
    assert.equal(state.sendClicks, 1);
    assert.deepEqual(state.records.at(-1).targets.map(target => target.status), ['uncertain']);
  }
});

test('existing drafts are preserved and uncertain sends are never retried', () => {
  const draft = fixture({ existingDraft: '客户原草稿', groups: ['群甲'] });
  assert.throws(
    () =>
      draft.runner.run(workflow('wecom-broadcast'), {
        dryRun: true,
        input: input(undefined, { groups: true, direct: false }),
      }),
    /已有草稿/,
  );
  assert.equal(draft.state.draft, '客户原草稿');
  assert.equal(draft.state.sendClicks, 0);

  const uncertain = fixture({ uncertain: true, groups: ['群甲', '群乙'] });
  assert.throws(
    () =>
      uncertain.runner.run(workflow('wecom-broadcast'), {
        dryRun: false,
        input: input(undefined, { groups: true, direct: false }),
      }),
    /connection lost/,
  );
  assert.equal(uncertain.state.sendClicks, 1);
  assert.deepEqual(
    uncertain.state.records.at(-1).targets.map(item => item.status),
    ['uncertain'],
  );
});

test('HTTP message freshness and lifecycle context remain deterministic', () => {
  const { runner, state } = fixture({ groups: ['群甲', '群乙'] });
  runner.run(workflow('wecom-broadcast'), {
    dryRun: true,
    input: input(
      { type: 'http', request: request(), refresh: 'recipient' },
      { groups: true, direct: false },
    ),
  });
  assert.deepEqual(state.typed, ['fresh-1', 'fresh-2']);

  const lifecycle = fixture({ groups: ['群甲', '群乙'] });
  const after = request({ type: 'ignore' });
  after.method = 'POST';
  after.body = {
    mode: '{{run.mode}}',
    status: '{{run.status}}',
    completed: '{{result.completed}}',
  };
  lifecycle.runner.run(workflow('wecom-broadcast'), {
    dryRun: true,
    input: input(
      { type: 'before_run' },
      { groups: true, direct: false },
    ),
    hooks: { beforeRun: request(), afterRun: after },
  });
  assert.deepEqual(lifecycle.state.requests[1].body, {
    mode: 'rehearsal',
    status: 'completed',
    completed: '2',
  });
});

test('HTTP parsing and authentication enforce boundaries without retry', () => {
  const { io, state } = fixture();
  const credential = '11111111-1111-4111-8111-111111111111';
  for (const auth of [
    { type: 'none' },
    { type: 'bearer', credential },
    { type: 'basic', username: 'user', credential },
    {
      type: 'api_key',
      name: 'X-Key',
      location: 'header',
      credential,
    },
    { type: 'api_key', name: 'key', location: 'query', credential },
  ]) {
    const spec = request({ type: 'json', pointer: '/data/message' });
    spec.auth = auth;
    spec.method = 'POST';
    spec.query = [
      { name: 'who', value: '{{recipient.title}}' },
    ];
    spec.body = { mode: '{{run.mode}}' };
    io.request = value => {
      state.requests.push(value);
      return { status: 200, body: '{"data":{"message":"你好"}}' };
    };
    assert.equal(
      http.fetch(
        spec,
        { recipient: { title: '测试群' }, run: { id: 'abc', mode: 'send' } },
        io,
      ).message,
      '你好',
    );
  }
  assert.throws(
    () => http.validate({ ...request(), url: 'http://example.com' }, io),
    /HTTPS/,
  );
});

test('JavaScript response processing shares fetch, preview and offline validation', () => {
  const { io, state } = fixture();
  const raw = '{"data":[{"message":"甲"},{"message":"乙"}]}';
  io.request = value => { state.requests.push(value); return { status: 200, body: raw }; };
  const response = { type: 'javascript', code: 'return res.data.map(function (item) { return item.message; }).join("\\n");' };
  assert.equal(http.parse(raw, response, io), '甲\n乙');
  assert.equal(http.fetch(request(response), {}, io).message, '甲\n乙');
  assert.equal(http.preview(request(response), {}, io).message, '甲\n乙');
  assert.equal(http.parse('plain text', { type: 'javascript', code: 'return res.toUpperCase();' }, io), 'PLAIN TEXT');
  assert.equal(http.parse('"JSON string"', { type: 'javascript', code: 'return res;' }, io), 'JSON string');
  for (const code of ['return res;', 'return 42;', 'return null;', 'return " ";', 'return "你".repeat(1334);', 'throw new Error("失败");']) {
    const parser = { type: 'javascript', code };
    assert.throws(() => http.parse(raw, parser, io), /JavaScript 处理失败/);
    assert.throws(() => http.fetch(request(parser), {}, io), /JavaScript 处理失败/);
    const preview = http.preview(request(parser), {}, io);
    assert.equal(preview.raw, raw);
    assert.equal(preview.message, null);
    assert.match(preview.parseError, /JavaScript 处理失败/);
  }
  const count = state.requests.length;
  for (const code of ['', '  ', 'return res.;', 'return res;' + ' '.repeat(10000)]) {
    assert.throws(() => http.fetch(request({ type: 'javascript', code }), {}, io), /JavaScript 代码/);
  }
  assert.equal(state.requests.length, count);
  for (const [pointer, expected] of [['', 'return res;'], ['/data/a~1b/~0key/0', 'return res["data"]["a/b"]["~key"]["0"];']]) {
    assert.equal(http.responseCode({ type: 'json', pointer }), expected);
  }
});

test('malformed pages and invalid recipient combinations stop before action', () => {
  const { io } = fixture();
  const valid = io.observe();
  assert.throws(
    () => core.validateScreen({ ...valid, certain: false }),
    /识别不完整/,
  );
  assert.throws(
    () =>
      core.validateInput({
        ...input(),
        recipients: { groups: false, direct: false },
      }),
    /至少选择/,
  );
  assert.throws(
    () => core.validateInput(input(undefined, { groups: 'yes', direct: false })),
    /勾选/,
  );
});

test('scheduled entry executes only WeCom workflows and releases resources', () => {
  function entry(io) {
    const module = { exports: {} };
    const wrapper = vm.runInThisContext(
      '(function(require,module,exports){' +
        readFileSync(wecomPath + 'main.js', 'utf8') +
        '\n})',
    );
    wrapper(
      specifier =>
        specifier === './wecom.js'
          ? { create: () => io }
          : loadMobile(createRequire(wecomPath + 'main.js').resolve(specifier)),
      module,
      module.exports,
    );
    return module.exports;
  }

  for (const item of definitions.workflows) {
    const { io, state } = fixture();
    let prepared = 0;
    let finished = 0;
    io.prepare = () => prepared++;
    io.finish = () => finished++;
    entry(io)({
      execution: { workflowId: item.id, dryRun: true },
      readConfig: () => ({ input: input(), hooks: {}, dryRun: false }),
    });
    assert.equal(prepared, 1);
    assert.equal(finished, 1);
    assert.equal(state.records.at(-1).status, 'completed');
    assert.equal(state.sendClicks, 0);
  }

  const { io } = fixture();
  assert.throws(
    () =>
      entry(io)({
        execution: { workflowId: 'wechat-open', dryRun: true },
        readConfig: () => ({}),
      }),
    /无效/,
  );
});

test('WeCom 5.0.12 keeps verified native control IDs', () => {
  const wecom = loadMobile(wecomPath + 'wecom.js');
  const ids = loadMobile(wecomPath + 'wecom-ids.js');
  const profile = ids.profile('5.0.12');
  assert.equal(profile.i_6, 'iu5');
  assert.equal(profile.i_d, 'ith');
  assert.equal(profile.lba, 'm0f');
  assert.equal(profile.km_, 'l_8');
  const inverse = Object.fromEntries(
    Object.entries(profile).map(([canonical, raw]) => [raw, canonical]),
  );
  const nodes = [
    { id: 'o6j', text: '消息', bounds: [489, 121, 591, 190] },
    { id: 'db5', text: '', bounds: [0, 228, 1080, 2111] },
    { id: 'fwr', text: '全部', bounds: [109, 281, 187, 331] },
  ].map(node => ({
    ...node,
    id: inverse[node.id],
    visible: true,
    enabled: true,
  }));
  assert.equal(wecom.homeReady(nodes, 1080), true);
  assert.deepEqual(ids.profile('legacy'), {});
});
