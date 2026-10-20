# Android 9 / AutoJs6 微信 Unicode 输入与完整编辑框回读核查

核查日期：2026-10-20。目标环境由本轮实测上下文提供：vivo X21、Android 9、WeChat 8.0.79、官方 AutoJs6 6.7.0；无障碍已开启，但该窗口的编辑节点不可用。本文不把这些上下文当作本研究重新验证的结果。只读公开源码/官方文档；未操作或查询手机/ADB、截图、调用模型、读取密钥或账号文件、修改应用代码。Context7 查询仍因月额度耗尽失败，改按以下固定源码核查。

## 结论与三种路径

**若同时要求“手机脱离 ADB、完整 Unicode 填入、完整 editor 回读、核对后清空、不点发送、不使用 OCR”，目前最小完整候选是一个极小的自有 InputMethodService helper APK。** 用户先启用并选择该输入法，AutoJs6 和 PC 都调用同一受保护的编辑协议。是否能完整读取这个微信版本的 InputConnection，仍须真机验收；不能从输入法 API 的存在推导出微信已通过。

| 路径 | 已核实能做什么 | 为什么尚不足/适用范围 |
| --- | --- | --- |
| **不加 APK，仅现有 AutoJs6** | Unicode `setText/input`、节点 `paste/copy/cut`、系统剪贴板。 | 这些编辑动作仍依赖可用无障碍节点；剪贴板内容不是 editor 回读。Android 9 没有 API 33 的无障碍 InputConnection。当前节点不可用时，没有找到公开的完整原生替代接口。 |
| **官方 uiautomator2 helper IME** | 2.4.0 的 `com.github.uiautomator/.AdbKeyboard` 可经 InputConnection 提交 Unicode、替换/清理文字，普通 AutoJs6 可在其已选中后发 Android 广播调用。 | 未暴露完整 editor 读取接口；ACK 可能假成功，清理有选区/提取文本边界，广播未鉴权。可用于受控验证 Unicode 路径，不能直接满足完整交付协议。 |
| **极小自有 IME helper** | 可提供 `status/read/replace/clearOwned/restoreIme`，基于当前 InputConnection 与 EditorInfo，绕开粘贴菜单和节点树。 | 新增一个 APK；首次启用/选择仍需用户或已授权 shell。必须验证目标 editor 的提取完整性，认证调用者，防止清理已有草稿。 |

本次不建议继续给“长按→找粘贴菜单”增加截图等待，也不缩小为只支持 ASCII。

## 1. AutoJs6 6.7.0 已有能力与边界

### 无需额外 APK 的原生动作

- `setText(text)` 与 `input(text)` 最终分别落到可编辑节点的 `ACTION_SET_TEXT` 和追加动作；`UiObject.setText(String)` 也是 `AccessibilityActionCompat.ACTION_SET_TEXT`。不是注入到当前键盘的 Unicode 通道。[Automator](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/runtime/api/augment/automator/Automator.kt#L440)、[SimpleActionAutomator](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/core/accessibility/SimpleActionAutomator.kt#L109)、[UiObjectActions](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/core/automator/UiObjectActions.kt#L156)
- `UiObject.paste()` 直接 `performAction(ACTION_PASTE)`，`copy()/cut()` 类似；**节点可用时**不必打开可视粘贴菜单。但它仍要求目标支持该 accessibility action，不能解决当前无节点的窗口。[节点剪贴板动作](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/core/automator/UiObjectActions.kt#L103)
- `setClip/getClip` 读写 Android ClipboardManager，只证明剪贴板被设置/读到，不能证明目标输入框收到、全文一致或已经清空。[ClipboardUtils](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/util/ClipboardUtils.kt)

官方 v6.7.0 完整文件树和 Manifest 未发现可由用户选择的 InputMethodService；`InputMethodUtils` 仅隐藏键盘，没有绑定目标 editor 的读取/提交服务。[Manifest](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/AndroidManifest.xml)、[InputMethodUtils](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/util/InputMethodUtils.kt)

Android 的无障碍 `InputMethod.AccessibilityInputConnection.commitText` 是 **API 33**，不能用在 Android 9/API 28。[官方 API](https://developer.android.com/reference/android/accessibilityservice/InputMethod.AccessibilityInputConnection)

**权限事实：** 普通进程的 `shell('input ...')` 不会变成 adb shell；Android 9 的跨进程 `INJECT_EVENTS` 是 signature 权限。AutoJs6 在 Manifest 声明 `WRITE_SECURE_SETTINGS` 也不等于已经获得它，更不等于获得注入事件权限。[Android 9 权限定级](https://android.googlesource.com/platform/frameworks/base/+/android-9.0.0_r61/core/res/AndroidManifest.xml#2660)

加载一个 DEX 也不能把未在宿主 Manifest 注册的 IME 变成系统输入法。Android 要求安装的应用声明 `InputMethodService`、`BIND_INPUT_METHOD`、`android.view.InputMethod` 与元数据；这属于 APK 组件注册。[官方 IME 指南](https://developer.android.com/develop/ui/views/touch-and-input/creating-input-method#IMEManifest)

## 2. 官方 helper 的准确版本、包与 APK

本次区分两个版本，不把名字混用：

| 固定版本 | IME component | 原生输入接口 |
| --- | --- | --- |
| android-uiautomator-server **2.3.3**，commit `c418ffb59433aea059d50d0afe20d44ef1c61a87` | `com.github.uiautomator/.FastInputIME` | `ADB_INPUT_TEXT`、`ADB_SET_TEXT`、`ADB_CLEAR_TEXT`；`text` 是 UTF-8 Base64。 |
| android-uiautomator-server **2.4.0** | `com.github.uiautomator/.AdbKeyboard` | 新的 `ADB_KEYBOARD_*` 名称；不是 `.FastInputIME`。 |

证据：[旧 FastInputIME 源码](https://github.com/openatx/android-uiautomator-server/blob/2.3.3/app/src/main/java/com/github/uiautomator/FastInputIME.java)、[旧 Manifest](https://github.com/openatx/android-uiautomator-server/blob/2.3.3/app/src/main/AndroidManifest.xml#L92)、[2.4.0 AdbKeyboard](https://github.com/openatx/android-uiautomator-server/blob/2.4.0/app/src/main/java/com/github/uiautomator/AdbKeyboard.java)、[2.4.0 Manifest](https://github.com/openatx/android-uiautomator-server/blob/2.4.0/app/src/main/AndroidManifest.xml#L93)。

uiautomator2 本次固定 HEAD 为 `bad641e7a8614836833f11ee9a4e07fec1c151c3`（2026-10-18），[version.py](https://github.com/openatx/uiautomator2/blob/bad641e7a8614836833f11ee9a4e07fec1c151c3/uiautomator2/version.py) 固定 helper APK 版本 `2.4.0`；[assets/sync.sh](https://github.com/openatx/uiautomator2/blob/bad641e7a8614836833f11ee9a4e07fec1c151c3/uiautomator2/assets/sync.sh) 从上述官方仓库 Release 下载 `app-uiautomator.apk`；[_input.py](https://github.com/openatx/uiautomator2/blob/bad641e7a8614836833f11ee9a4e07fec1c151c3/uiautomator2/_input.py#L40) 使用 `.AdbKeyboard`，旧 `set_fastinput_ime()` 只是 deprecated 别名。

官方安装资产为 [2.4.0 / app-uiautomator.apk](https://github.com/openatx/android-uiautomator-server/releases/download/2.4.0/app-uiautomator.apk)，不是 `app-uiautomator-test.apk`，也不是本项目已用的 `u2.jar`。本研究仅在内存下载公开 APK 并读取 ZIP/DEX 字符串，未写入/安装手机：大小 **1,873,729 bytes**，SHA-256 **`6f85594700ad96de89d012b3767049c2c6988510b68b31b439dd2a6dd93a30c9`**；DEX 含 `AdbKeyboard`、不含 `FastInputIME`。此哈希是本次官方资产快照，不等于独立 APK 签名审计。

### 2.4.0 可调用动作

| 广播 action | extras | 源码行为 |
| --- | --- | --- |
| `ADB_KEYBOARD_INPUT_TEXT` | `text: String`，UTF-8 Base64 | `InputConnection.commitText(decodedText, 1)`；在光标处插入/替换当前选区，不是全文 overwrite。 |
| `ADB_KEYBOARD_SET_TEXT` | 同上 | beginBatchEdit → clearText → commitText → endBatchEdit。 |
| `ADB_KEYBOARD_CLEAR_TEXT` | 无 | 先提取 editor，再读取光标两侧并 `deleteSurroundingText`。 |
| `ADB_KEYBOARD_GET_CLIPBOARD` | 无 | ordered-broadcast resultData 返回剪贴板 UTF-8 Base64；**不是 editor 内容**。 |
| `ADB_KEYBOARD_SHOW/HIDE` | 无 | 显示/隐藏输入法面板，不是获得焦点/确认 editor readiness。 |

这些动作通过 `InputConnection` 提交字符串，中文、emoji、多行不依赖 ASCII 键码，也不依赖可视粘贴菜单。源码还包含 `SMART_ENTER/EDITOR_CODE/INPUT_KEYCODE`；本任务必须禁用这些调用，尤其不能调用 Enter、IME_ACTION_SEND 或 SMART_ENTER。[AdbKeyboard 动作实现](https://github.com/openatx/android-uiautomator-server/blob/2.4.0/app/src/main/java/com/github/uiautomator/AdbKeyboard.java#L117)

### 不能当成完整 read/set/clear 协议的原因

1. **没有公开 editor read action。** `getText()` 虽有源码，却是未接到广播的 private 方法；只把 hintMaxChars 设为 100000 不会形成外部接口。普通 AutoJs6 无法跨进程调用该 IME 实例的私有函数，自己 new 一个服务对象也拿不到系统绑定的 InputConnection。
2. **ACK 不证明编辑成功。** `ic == null` 或 `text` 缺失时，`handleAction` 直接返回 action，但外层仍设 `RESULT_OK=-1`；`commitText` 的 boolean 也未核查。uiautomator2 的 `_wait_ime_ready` 只看默认 IME ID，不检查 InputConnection 或 editor 包。不能把广播 result=-1 当作全文已输入。
3. **clear 有实质边界。** `getExtractedText` 为 null 会失败；光标前后读取允许少于请求长度，可能不完整；`deleteSurroundingText` 明确**不删除选区本身**，所以选中文本不能据此保证 clear 后为空。`SET_TEXT` 随后的 commit 可能替换选区，但没有全文回读作证。[clear/getText 源码](https://github.com/openatx/android-uiautomator-server/blob/2.4.0/app/src/main/java/com/github/uiautomator/AdbKeyboard.java#L265)、[Android 9 InputConnection](https://android.googlesource.com/platform/frameworks/base/+/android-9.0.0_r61/core/java/android/view/inputmethod/InputConnection.java#319)
4. **调用未鉴权。** `registerReceiver(receiver, filter)` 无发送权限参数；receiver 没有校验 UID、签名、包或 token。`BIND_INPUT_METHOD` 只保护系统绑定服务，不能保护这些自定义广播。其他同用户应用可以在服务存在且有 editor 时输入/清理；Base64 仅编码，不是鉴权或加密。[receiver 注册](https://github.com/openatx/android-uiautomator-server/blob/2.4.0/app/src/main/java/com/github/uiautomator/AdbKeyboard.java#L59)

uiautomator2 `_must_broadcast` 还会对失败 ACK 重试最多 3 次；接收者若已提交文本但客户端没拿到结果，插入型请求重试可能重复文字。不能把 Python 客户端的重试语义直接带入本项目“结果未知不自动重放”的协议。[_input.py](https://github.com/openatx/uiautomator2/blob/bad641e7a8614836833f11ee9a4e07fec1c151c3/uiautomator2/_input.py#L95)

旧 2.3.3 FastInputIME 同样没有开放 editor read，receiver 更晚到 `onCreateInputView` 才注册；不应为保留旧类名而回退旧 APK。其广播还会把 Base64 输入写入 Log；不适合作为含敏感文本的生产协议。

## 3. 无 ADB 的 AutoJs6 能否调用、如何启用与恢复

**调用：可以，前提是 helper 已安装、启用、成为当前 IME，目标输入框真实获得编辑焦点。** 在 Android 9，普通 AutoJs6 可通过 `context.sendBroadcast()`，或带 result receiver 的 `context.sendOrderedBroadcast()` 发上述 action；可 `Intent.setPackage('com.github.uiautomator')` 限定接收包。这不是执行 `adb shell am broadcast`，不需要安装 Python/u2服务。ordered result 只用于观察 helper ACK，仍受上面的假成功限制。

**启用/选择是另一授权环节：**

- 普通用户路径：系统输入法设置启用 helper，再通过 `InputMethodManager.showInputMethodPicker()` 选择它；开启无障碍不会自动启用/选择输入法。[官方 IME 指南](https://developer.android.com/develop/ui/views/touch-and-input/creating-input-method)、[picker](https://developer.android.com/reference/android/view/inputmethod/InputMethodManager#showInputMethodPicker())
- PC shell 路径：uiautomator2 明确执行 `ime enable`、`ime set`、写 `Settings.Secure.default_input_method`。Android 9 AOSP 对 enable/disable 和无当前 IME token 的切换检查 `WRITE_SECURE_SETTINGS`；普通 AutoJs6 未被授权时不能自行静默照做。[u2 设置流程](https://github.com/openatx/uiautomator2/blob/bad641e7a8614836833f11ee9a4e07fec1c151c3/uiautomator2/_input.py#L43)、[Android 9 系统校验](https://android.googlesource.com/platform/frameworks/base/+/android-9.0.0_r61/services/core/java/com/android/server/InputMethodManagerService.java#3265)、[enable 权限](https://android.googlesource.com/platform/frameworks/base/+/android-9.0.0_r61/services/core/java/com/android/server/InputMethodManagerService.java#4938)
- 有事先明确授予的 secure-settings/shell/root 能力时可有自动切换路径，但不能因 Manifest 声明就当它存在；首次验收应走可解释的用户启用/选择流程。本研究未查询此手机当前权限。

**恢复原 IME：** PC 可保存原默认 IME ID 并在 finally 恢复；`set_input_ime(false)` 是 disable helper，不等价于精准恢复原输入法/子类型。现有 AdbKeyboard 广播没有 RESTORE 动作，仅键盘按钮打开 picker。自有 helper 作为当前 IME，可使用 Android 9 已有的 `switchToPreviousInputMethod()`（API 28）或 `switchInputMethod(enabledId)`，无需把 IME token 交给 AutoJs6；失败则让用户选回。[InputMethodService 切换 API](https://developer.android.com/reference/android/inputmethodservice/InputMethodService#switchToPreviousInputMethod())

**Android 9 可靠性边界：** helper 的 minSdk 为19，InputConnection 字符串提交/提取等 API 在 API28 已存在，所以该 OS 没有 API 级别障碍；实际能否获得 WeChat 8.0.79 的完整文本、连接会否切换，仍未知。默认 IME 已选中、键盘看起来出现、无障碍已开启，三者都不能代替 editor session 验证。

## 4. 自有极小 IME：最小完整推荐

该建议只为补上“无节点时完整输入/回读/清理”的缺口，不替换现有 AutoJs6 工作流或桌面栈。可借鉴官方 helper 的 MIT 代码并保留许可，不需打包整个测试服务。[上游 MIT](https://github.com/openatx/android-uiautomator-server/blob/2.4.0/LICENSE)

### 最小接口与编辑语义

| 接口 | 必要行为 |
| --- | --- |
| `status` / `read` | 返回 current IME、`EditorInfo.packageName/inputType/fieldId`、本次连接 sessionId、完整提取文本/选区和 completeness；无连接、错误目标、密码/敏感输入、提取失败均返回显式失败。 |
| `replace(expectedText, text, sessionId, requestId)` | 对同一目标连接先回读并逐字匹配 expectedText，结束 composing，再选定完整旧文本并 commit Unicode 新文本；回读核对成功才 ACK。默认只允许 expectedText 为空，避免清除用户草稿。 |
| `clearOwned(expectedText, sessionId, requestId)` | 只在当前全文仍等于本轮写入值时删除；清理后回读必须等于空串。遇到用户改动、连接改变或结果未知，停止，禁止盲目再清理。 |
| `restoreIme` | 仅在仍由 helper 持有当前 IME、且用户未自行切换时恢复；错误可见，不覆盖用户的新选择。 |

不提供 send/Enter/editorAction。读写操作串行、按 editor session 与请求 ID 防重复；调用超时标为 unknown，不自动重放副作用。返回完整字符串在本地比较，不用 OCR、截图或模型作编辑成功依据。

**原生实现依据：** 当前 IME 通过 `getCurrentInputConnection()` 获取绑定连接，`getCurrentInputEditorInfo()` 获取目标信息；文本用 `commitText(CharSequence,1)`，替换可以 `finishComposingText → beginBatchEdit → setSelection(0, fullText.length) → commitText(newText,1) → endBatchEdit`，最后重新读。selection 索引按 UTF-16 code units，不能错误地用 Unicode code-point 数量。[InputMethodService](https://developer.android.com/reference/android/inputmethodservice/InputMethodService#getCurrentInputConnection())、[Android 9 InputConnection 合约](https://android.googlesource.com/platform/frameworks/base/+/android-9.0.0_r61/core/java/android/view/inputmethod/InputConnection.java#515)

**“完整回读”的条件必须认真处理：** `getExtractedText(request,0)` 可能为 null，request 的 hintMaxChars/hintMaxLines 只是提示；`ExtractedText.startOffset` 是返回片段在全文中的起点，`partialStartOffset=-1` 才表示完整文本而非局部更新。至少拒绝 offset非0/partial/超出明确大小边界/前后校验不一致的结果，不能把“最多读了 N 字符”标成全文；目标若不遵守完整提取协议，helper 也不能凭空保证完整。旧 helper 的 `getTextBeforeCursor/getTextAfterCursor` 允许少取，不能直接拼接就自称完整。[Android 9 提取合约](https://android.googlesource.com/platform/frameworks/base/+/android-9.0.0_r61/core/java/android/view/inputmethod/InputConnection.java#288)、[ExtractedText 字段](https://android.googlesource.com/platform/frameworks/base/+/android-9.0.0_r61/core/java/android/view/inputmethod/ExtractedText.java#25)

### 一个同时供 PC/AutoJs6 调用的最小通道

可用 helper 内的受保护 `ContentProvider.call` 作为本地控制入口，无需 HTTP 后端或额外常驻服务器：AutoJs6 使用 `context.getContentResolver().call(uri, method, arg, bundle)`；PC 使用已有 ADB 的 `content call --uri ... --method ... --extra ...`。Android 9 官方 CLI 已支持这一路径；在 helper 主线程与当前 IME 串行执行编辑，控制调用有有限超时。[Android 9 content CLI](https://android.googlesource.com/platform/frameworks/base/+/android-9.0.0_r61/cmds/content/src/com/android/commands/content/Content.java#117)

**认证是该通道的必要部分：** `ContentProvider.call` 不会自动替实现者完成权限检查；应在 Binder 入口验证调用 UID/已配对 AutoJs6 包签名，PC shell 路径也须明确授权，不能只信请求 extras 里的包名或公开 action。不要复刻官方 helper 的开放输入广播；受信客户端以外不能读 editor 或触发任何编辑。官方 AutoJs6 与自有 helper 不同签名，不能假定简单设 signature 权限就能让 AutoJs6 直接访问。[Android 9 ContentProvider.call/调用包校验](https://android.googlesource.com/platform/frameworks/base/+/android-9.0.0_r61/core/java/android/content/ContentProvider.java#1950)

这是建议接口，尚未实现/验证。上游 u2 2.4.0 helper 原样安装不能获得上述 read、认证、session及所有权清理语义。

## 5. PC 现有能力与验收边界

本项目已有的官方 `u2.jar` 0.4.0 还提供 `pasteClipboard()`，其实现是注入 **Ctrl+V**；`clearInputText()` 是 Ctrl+A 后 Delete。它在 shell 身份下可绕开可视粘贴菜单，但不提供完整 editor 文本读取，且不能直接搬到普通 AutoJs6 进程。它与 helper IME 是不同通道，不应统称“FastInputIME 已支持”。[固定 jar 源码](https://github.com/openatx/android-uiautomator-server-jar/blob/0.4.0/app/src/main/java/com/wetest/uia2/stub/AutomatorServiceImpl.java#L1673)

**最小验收建议：** 先在准确的微信编辑 session 中只做 read→在空框写入→完整回读→clearOwned→回读空串→恢复 IME，全程不发送。样例同时含中文、emoji/代理对、多行、标点，以及超过单屏的前后标记文本；测试光标中间、选区、composing、已有草稿、切换 editor、失焦和操作超时。不得用 ASCII 样例替代 Unicode 验收，也不得以 ACK 或剪贴板回读代替 editor 回读。

本研究没有验证 vivo/微信的 InputConnection 完整提取能力；这是决定自有极小 IME 能否完成目标的首个真机检查项。若完整提取失败，应明确停止并报告限制，不把部分文本、OCR 或静默清草稿当作通过。
