# Mika 原理拆解与 por-auto APK 复刻方案

> 调研对象：`github.com/wangzan101/mika`（Apache-2.0，main 分支，2026-11-01 时点；`versionName 0.1.31` / `versionCode 32`）
> 调研方式：源码 + README/docs 静态阅读，未在真机运行。标「源码」的以代码为准，标「文档」的以作者说明为准。
> 本文只做调研与方案，不含实现。

---

## 0. 结论先行

1. **Mika 的核心不是「无障碍自动化」，而是「App 进程 + shell 助手进程 + 虚拟屏 + 无障碍」四件套。**
   - App 进程（普通权限）：界面、模型、Agent 循环、无障碍读屏。
   - Helper 进程（shell uid 2000）：由「无线调试」配对或 USB adb 启动，负责建虚拟屏、把 App 启动到虚拟屏、注入触摸/按键、改系统设置。
2. **它也不是「装完就能操作 App」**：操作 App 前要做一次「设置手机操作」向导（配对无线调试，或电脑跑一条 adb 命令）。不设置只能聊天/网页/文件。
3. **Mika 的「预置流程」是学习出来的，不是手写的**：成功运行后记成 Route（模板 + 槽位 + 选择器 + 前后锚点），下次同样的话不调模型直接回放；对不上就交还模型。真正可手写的是知识（Markdown）和技能（Markdown）。
4. **对 por-auto 的启示：不要照搬虚拟屏。** 你的主场景（企微群发）在前台用无障碍就能完成。建议 **前台无障碍优先，虚拟屏后置**；预置工作流做第一执行路径，AI 做入口和兜底。
5. **推荐 MVP**：单 APK、无 PC、无无线调试；手写工作流 + 确定性执行器 + 可选 AI 路由；先把「给全部群组发 1」在真机跑通，再谈后台屏和通用 Agent。

---

## 1. Mika 的产品形态

| 项目 | 说明 |
|---|---|
| 形态 | 单个 APK，无服务端；模型 Key、对话、运行记录都在手机 |
| 系统 | 安装 Android 11+；操作 App 需要 12+，推荐 14+；沙箱仅 arm64 |
| 操作 App 的前提 | 设置 › 手机操作，配对一次无线调试；或电脑 USB 跑 `usb-start.sh` |
| 模式 | Ask（默认，只在花钱时问）/ Autonomous（连付款也不问） |
| 能力 | 操作任意 App（后台屏）、内置浏览器、当前屏幕、定时/条件任务、记忆、技能、Linux 沙箱、MCP/CLI 远程任务 |
| 模型 | OpenAI-compatible、Anthropic、Gemini、OpenAI Responses；也支持 ChatGPT/xAI/OpenRouter 账号登录 |
| 许可 | Apache-2.0 |

一句话：**Mika 是一个「用模型规划、用工具操作手机」的通用 Agent，虚拟屏只是它不打扰用户的实现手段。**

---

## 2. 总体架构

### 2.1 两个进程

```
┌──────────────────────── App 进程 (uid=app) ────────────────────────┐
│ Compose UI / Chat / Task Center / Settings                          │
│ AgentLoop ── ModelCaller ── OpenAI / Anthropic / Gemini             │
│ ToolDispatcher ── Phone / Web / Sandbox / General                   │
│ ScreenPort                                                          │
│   ├─ AccessibilityService ── windowsOnAllDisplays[displayId]        │
│   └─ AgentDisplay ── ImageReader ← 虚拟屏 surface                   │
│ HelperLink (IMikaShell Binder)                                      │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ Binder（nonce + 签名指纹 + uid 校验）
┌──────────────────────────────┴─────────────────────────────────────┐
│ Helper 进程 (uid=2000 shell, app_process 启动)                      │
│ ShellService:                                                       │
│   DisplayManager.createVirtualDisplay(surface, TRUSTED|OWN_FOCUS…)  │
│   IActivityTaskManager.startActivityAsUser(… setLaunchDisplayId)    │
│   InputManager.injectInputEvent(MotionEvent/KeyEvent, displayId)    │
│   appops 静音 / 剪贴板 / 任务栈查询 / settings put secure …          │
└─────────────────────────────────────────────────────────────────────┘
```

**App 进程**（`app/` + `core/`）
- `core/` 是纯 Kotlin/JVM：AgentLoop、工具注册与分发、路线回放、知识、触发、模型客户端、记录。可跑 JVM 单测。
- `app/` 是 Android 能力：Compose 单 Activity、`TaskService` 前台服务、`MikaAccessibilityService`、WebView、通知、定时、Keystore、文件存储。

**Helper 进程**（源码：`HelperProcess.kt`、`ShellService.kt`、`HelperHandoff.kt`）
- 进程名 `<pkg>:helper`，uid 2000，由 `app_process` 加载**同一个 APK** 的 classes 启动：

  ```
  CLASSPATH=<base.apk> app_process /system/bin --nice-name=<pkg>:helper \
    com.wangzan101.mika.shell.HelperMain <pkg> <app-uid> <cert-sha256>
  ```

- 一次性口令从 stdin 读，不进命令行（避免 `/proc/<pid>/cmdline` 泄露）。
- 通过 `ContentProvider.call("attach", …)` 把 `IMikaShell` Binder 交给 App；App 侧校验：
  - 调用方 uid 必须是 2000（shell）；
  - 助手自报 uid/pid 与 Binder 看到的一致；
  - 助手跑的 APK 路径与当前安装一致（防止旧版本残留）；
  - 签名证书 SHA-256 指纹匹配；
  - nonce 一次性有效（`HandoffNonces`）。
- 职责：建虚拟屏、把 App 启动到虚拟屏、注入输入、静音、剪贴板、任务栈查询、改系统设置（无障碍、电池白名单）。

### 2.2 为什么必须是 shell

普通 App 做不到这些：
- 创建 **trusted virtual display**（`DisplayManager.createVirtualDisplay` + `FLAG_TRUSTED` / `FLAG_OWN_FOCUS` / `FLAG_STEAL_TOP_FOCUS_DISABLED`）；
- 把别的 App 启动到指定 display（`IActivityTaskManager.startActivityAsUser` + `ActivityOptions.setLaunchDisplayId`）；
- 向指定 display 注入 `MotionEvent` / `KeyEvent`（`InputManager.injectInputEvent`）；
- 改 `enabled_accessibility_services`、`appops`、电池白名单。

Mika 没有 root。它用「无线调试配对」拿到 adbd 的 `exec:` 流，从而以 shell 身份启动自己的代码。**这是整个方案里最重、最敏感的一块。**

### 2.3 一次任务的完整数据流

1. 用户说话 → `TaskService` 建 `TaskRun` → `AgentLoop`。
2. 组装系统提示词：基础提示 + 能力段落 + 命中的 App/站点知识 + 记忆 + 技能索引。
3. 调模型（流式），模型返回 tool call。
4. `ActionExecutor` → `ToolDispatcher` → `PhoneCapability`。
5. `PhoneCapability` 通过 `ScreenPort` 读当前虚拟屏（无障碍树 + 可选截图/OCR）。
6. 写动作前：守卫、确认、节奏、锁屏等待；然后 `AgentScreen.tap/type/...`。
7. 触摸走无障碍 `GestureDescription.setDisplayId`；按键走 `Helper.injectKey`；输入走无障碍 `ACTION_SET_TEXT` 或 IME。
8. 动作后读一屏，算 `changed` / `verification` / `effect`，作为工具结果回给模型。
9. 循环直到模型不再调工具（最终回答），或 `ask_user` / `hand_to_user` / `end_not_done`。
10. 运行记录、截图、token 计量、路线学习（成功且可回放时）。

### 2.4 关键源码索引

| 主题 | 路径 |
|---|---|
| 助手入口 | `app/src/main/java/com/wangzan101/mika/cap/phone/shell/HelperProcess.kt` |
| 助手特权操作 | `app/src/main/java/com/wangzan101/mika/cap/phone/shell/ShellService.kt` |
| 交接协议/启动命令 | `core/src/main/kotlin/com/wangzan101/mika/core/shell/HelperHandoff.kt` |
| 虚拟屏取帧 | `app/src/main/java/com/wangzan101/mika/cap/phone/display/AgentDisplay.kt` |
| 无障碍服务 | `app/src/main/java/com/wangzan101/mika/cap/phone/a11y/ScreenAccessibility.kt` |
| 无障碍树归一化 | `app/src/main/java/com/wangzan101/mika/cap/phone/a11y/ScreenReader.kt` |
| 手机查询/跨屏合并 | `core/src/main/kotlin/com/wangzan101/mika/core/cap/phone/PhoneAutomationEngine.kt` |
| Agent 循环 | `core/src/main/kotlin/com/wangzan101/mika/core/agent/AgentLoop.kt` |
| 工具组装 | `core/src/main/kotlin/com/wangzan101/mika/core/assembly/TaskTools.kt`、`RunAssembler.kt` |
| 路线记录/匹配/回放 | `core/src/main/kotlin/com/wangzan101/mika/core/replay/RouteRecorder.kt`、`RouteMatcher.kt`、`Replayer.kt`、`Route.kt` |
| 定时 | `core/src/main/kotlin/com/wangzan101/mika/core/trigger/Triggers.kt`、`general/ScheduleTask.kt` |
| 知识 | `core/src/main/kotlin/com/wangzan101/mika/core/knowledge/`、`core/src/main/resources/knowledge/apps/` |
| 前台服务 | `app/src/main/java/com/wangzan101/mika/task/TaskService.kt` |
| 清单/无障碍配置 | `app/src/main/AndroidManifest.xml`、`app/src/main/res/xml/accessibility_service.xml` |
| 文档 | `docs/setup-guide.md`、`docs/features.md`、`docs/mcp.md`、`docs/cli.md` |

---

## 3. 核心机制

### 3.1 后台屏：虚拟显示 + shell 助手

#### 一句话版本

> 用 shell 权限在系统里「再开一块看不见的屏幕」，把 App 启动到那块屏上；无障碍服务读那块屏的控件、把点击手势发给那块屏；画面通过 ImageReader 回到 App 里做预览/截图。

#### 3.1.1 启动链路

1. 用户在向导里打开开发者选项、USB 调试、无线调试，点「使用配对码配对设备」，拿到 6 位码。
2. Mika 在本机 mDNS 找 `_adb-tls-pairing._tcp` 端口，用配对码做 SPAKE2 + TLS 1.3 配对，保存客户端证书。
3. 之后连本机 adbd（`_adb-tls-connect._tcp` 或上次端口），TLS 1.3 握手，开 `exec:` 流。
4. 写入一次性 nonce，执行 2.1 的 `app_process` 命令，助手以 shell 身份常驻。
5. 助手通过 ContentProvider 把 Binder 交给 App；App 收下后开始建屏、跑任务。

> 源码：`AdbPairing.kt`、`AdbConnection.kt`、`BuiltinShellConnection.kt`、`HelperHandoff.kt`。Mika 自己实现了 ADB 协议（CNXN/STLS/TLS/SPAKE2/exec），没有依赖电脑上的 adb。
> 兜底：电脑 USB 跑 `adb shell sh …/usb-start.sh`，启动同一个助手；手机重启后要再跑一次。

#### 3.1.2 虚拟屏

- App 进程 `AgentDisplay` 建 `ImageReader`（RGBA_8888，2 个 buffer），把 surface 交给 helper。
- helper 调 `DisplayManager.createVirtualDisplay("mika-agent", w, h, dpi, surface, flags)`。
- flags（源码 `displayFlags`）：
  - 基础：`PUBLIC | OWN_CONTENT_ONLY | SUPPORTS_TOUCH | ROTATES_WITH_CONTENT | DESTROY_CONTENT_ON_REMOVAL`
  - Android 13+：`TOUCH_FEEDBACK_DISABLED`
  - trusted：`TRUSTED | OWN_DISPLAY_GROUP | ALWAYS_UNLOCKED`
  - Android 14+：`OWN_FOCUS | STEAL_TOP_FOCUS_DISABLED`（虚拟屏有自己的焦点，又不抢主屏焦点）
- 截图不靠无障碍：`ImageReader` 直接拿帧；预览限速 ≤10fps、宽 ≤360；OCR 用原尺寸。

#### 3.1.3 把 App 启动到虚拟屏

- 先查主屏有没有这个 App 的可见任务；有就拒绝（不打扰用户）。
- 再查另一块 Mika 屏是否已占用；有就拒绝（避免两个任务抢同一个 App）。
- 解析 launch intent；`startActivityAsUser(..., options=setLaunchDisplayId(displayId))`；失败退回 `am start --display`。
- 支持多用户/分身：`queryIntentActivitiesAsUser`、`ILauncherApps.startActivityAsUser`。
- 任务结束 App 留在后台屏；下次接着那一页。

#### 3.1.4 输入注入

- **触摸**：无障碍 `GestureDescription.Builder().setDisplayId(displayId)`（API 30+），支持 tap / 长按 / 滑动 / 多指。
- **按键**：helper `injectKey(displayId, keyCode)`，有白名单（不允许音量/电源/Home 等整机键）；失败退回 `input -d <displayId> keyevent`。
- **文字**：无障碍 `ACTION_SET_TEXT`；必要时 IME；回读校验。
- **剪贴板**：helper 以 shell 包名操作，粘贴只发到 Mika 的屏。

#### 3.1.5 权限自助

helper 用 shell 身份：
- `pm grant <pkg> android.permission.WRITE_SECURE_SETTINGS`
- `settings put secure enabled_accessibility_services …` + `accessibility_enabled 1`
- `cmd deviceidle whitelist +<pkg>`
- 必要时重启无障碍服务

这样绕开 sideload APK 手动开无障碍时的「受限制的设置」拦截。

#### 3.1.6 兼容性与限制

- Android 12+ 才能操作 App；14+ 才有独立焦点，能边用手机边跑；不同对话并行也要 14+。
- 无线调试会被系统在换 Wi-Fi/重启后关掉；Mika 有自动重开和 USB 兜底。
- 不同 OEM 的无线调试、虚拟屏、IME 行为有差异；Mika 提供 12 项兼容性自检。
- 没有 root；shell 权限来自 adb 调试通道。
- 安全面：helper 以 shell 身份常驻，能改系统设置；Mika 用签名指纹 + uid + nonce + APK 路径校验，但它仍是一个高权限组件。

### 3.2 读屏与控件模型

- `ScreenReader.read(windows, width, height)` 遍历 `AccessibilityNodeInfo`，过滤输入法/无障碍浮层/放大镜/分屏条；只保留可见、≥5px、有文字或可交互的节点。
- 每个元素归一化为 `UiElement`：
  - `ref`（`@e1`）、`role`、`name`
  - `bounds`（0–999 归一化）
  - `resourceId`、`clickable/editable/scrollable`
  - `hint`、`focused`、`secret`、`placeholder`、`searchField`、`states`
- 同时算一个 `hash`（文字、类名、位置、勾选、焦点、光标/选区），判断界面变没变。
- `ScreenSnapshot`：`snapshotId`、`packageName`、`windows`/`elements`、`protected`。
- 读不到（自绘 UI、WebView、游戏）时：ML Kit OCR 补文字；配置了视觉模型时截图给模型找控件。
- 密码框：`isPassword` → `secret`，不把文字发给模型。
- 跨屏稳定编号：模型看到 `s<N>`，动作前翻译回端口编号，避免 snapshot 失效后误点。

### 3.3 动作与守卫

**手机工具面**（源码 `PhoneGroup.tools`）：

| 类别 | 工具 |
|---|---|
| 读屏 | `observe`、`list_elements`、`screenshot`、`describe`、`find_visually`、`diagnose` |
| 动作 | `tap`、`scroll`、`swipe`、`type_text`、`clear_text`、`back`、`press_key` |
| 查询/采集 | `phone_find`、`phone_extract`、`phone_collect`、`phone_wait`、`phone_gesture` |
| App | `phone_launch_app`、`phone_list_apps`、`phone_share_text`、`phone_app_after_task` |
| 系统 | `phone_set_alarm`、`phone_set_timer`、`phone_show_alarms`、`phone_add_calendar_event`、`phone_system_command`、`phone_dialog` |
| 打开链接 | `open_link`（仅在 deepLinks 开关下） |

**选择器**：`ref` + `snapshotId`；`actionRef` 用于点击可点击祖先；`editRef` 用于输入；名字/资源 ID/角色/位置/序号；唯一匹配才做。

**结果契约**：`ok`、`changed`、`verification`（`match`/`mismatch`）、`effect`（`done`/`place_changed`/…）、`snapshotId`、`screen`（差异）。

**守卫**：
- `OperationGuards`：最大步数、重复动作、无进展；
- `OffScreenGuard`：锁屏/被切走/助手断开；
- `ConfirmationGate` + `IrreversibleDetector`：不可逆动作先确认；
- `AppPacing` / `GesturePacing` / `TypingPacing` / `OutwardPacing`：限速、随机间隔；
- `beforeWrite` 按 App 知识限屏数，超过 `page_limit` 停止。

### 3.4 Agent 循环

- 系统提示词 = 基础提示 + 各能力段落 + 命中的知识 + 记忆 + 技能索引。
- 工具分组「折叠」：只给模型当前需要的组，减少 token；任务开始时按话术预展开。
- 每次模型调用前刷新工具列表和提示词；模型返回 tool call 就执行，执行结果带 `snapshotId` 和变化摘要。
- 关键策略：
  - `IntentGate`：先判断「讨论/读取/操作」，避免把聊天当成操作；
  - `TurnPolicy` / `StopRules` / `StuckAdvice`：步数、卡住、重复、无进展；
  - `AnswerReview`：最终回答要有证据（读过的页面、截图）；
  - `LeakedToolCall`：模型把工具调用写成文字时退回；
  - `ContextCompressor` / `HistoryPruner`：上下文压缩；
  - `UsageMeter`：token 计量。
- 结局：不带工具调用的回复就是最终回答；`ask_user`、`hand_to_user`、`end_not_done` 是显式结局。

### 3.5 路线回放（Mika 的「预置流程」）

#### 一句话版本

> 成功办完一次后，把「点了哪些控件、输入了什么」记成一条路线；下次用户说同样的话，先按路线直接做，不调模型；页面一变就停，交还模型。

**记录条件**（`RouteRecorder`）：
- 运行成功（`TaskEnded.succeeded`）；
- 没有接管、确认、付款、密码框、受保护页面；
- 只含可回放的手机动作（用过网页/沙箱/问用户的不记）；
- ≤60 步、≤64KB。

**槽位**：
- 输入文字和目标名必须在用户原话里**恰好出现一次**；
- 模板用 `{n}` 替换；
- 槽不能重叠；
- 路线里永远不存用户没在原话里说过的字。

**选择器**（`Selector`）：
- 角色 + 名字（可为槽）+ 资源 ID + 归一化 bounds + 同序号；
- 记录时唯一则 `uniqueAtRecord=true`。

**锚点**（`Anchors`）：
- 动作前后各最多 3 段稳定文字（短、无数字/金额）；
- 排除列表/滚动区内容、输入框文字。

**匹配**（`RouteMatcher`）：
- 字符二元组 Jaccard ≥0.3，或包名命中；
- 一次模型调用选路线 + 抽槽；
- 代码再校验：槽值在原话里恰好出现一次，且填回模板正好得到原话。

**回放**（`Replayer`）：
- 锁屏关卡 → 读屏 → 核对包名/锚点/选择器唯一 → 执行 → 核对变化；
- 任何不符就 `Diverged` 交还模型；
- 不可逆操作 `StoppedForConfirmation`；
- 回放从不认为用户已同意。

**价值**：重复任务不花 token、快、稳定。
**代价**：只覆盖「和上次一模一样」的路径；页面一变就退回模型。

### 3.6 知识、技能、记忆

**知识**（`core/src/main/resources/knowledge/apps/<id>/APP.md`）：
- frontmatter：`name`、`display`、`packages`、`aliases`、`sites`、`open`、`pace`、`description`；
- 正文：界面、功能、注意事项；
- 任务命中包名/别名/站点时注入；
- 站点知识还有 `pace`，控制翻页节奏。

**技能**：
- 内置 how-to + 个人技能（`skill_search`/`skill_read`/`skill_save`）；
- Markdown；可在沙箱里跑脚本；
- 用户要求时由模型起草，用户批准后保存。

**记忆**：
- `MemoryExtractor` 只从用户原话提取；
- `SensitiveFilter` 过滤密码/验证码/卡号；
- 加密存本机；按相关性注入。

### 3.7 定时与条件

- `TriggerDefinition`：`nextAtMs`、`intervalMs`、`calendarTime/Zone/Days`、`conditionGoal`、`idleOnly`、`reminderText`。
- `TriggerStore` + `TriggerWindow` 账本：`Claimed → Dispatched → ActionDispatched → Delivered/Skipped/Failed`。
- `claimDue` 原子地推进下次时间并落账，避免重复执行。
- 一次性任务只在结果送达后删除；错过的间隔合并成一次；`idleOnly` 忙时稍后重查。
- 精确闹钟需要 `SCHEDULE_EXACT_ALARM`；没有就提示可能延迟。
- 在**原对话**里执行，结果回到对话。

### 3.8 网页、沙箱、MCP/CLI（与本方案关系不大，略）

- 网页：内置 WebView + CDP，真实点击/输入，页面正文/数据读取，翻页节奏。
- 沙箱：arm64 Linux rootfs，跑 Python/Node/shell，默认断网。
- MCP/CLI：手机监听 8765，USB 转发或局域网/私有网络，令牌鉴权；电脑上的 AI 可以交任务。

### 3.9 安全与接管

- Ask：只有花钱先问；Autonomous：连付款也直接做。
- `hand_to_user`：登录/验证码/付款/风控页交给用户，App 挪到主屏；用户处理完交还，Mika 重新核实。
- 停止后给 `StopSummary`：做了什么、看到什么、发了几次、哪些没做完；「继续」接着做。
- 发送类动作只点一次，不自动重发；结果不明标 `uncertain`。

---

## 4. por-auto 复刻方案

### 4.1 目标与边界

**目标**
- 单 APK，安装即用；不依赖 PC、ADB、AutoJs6、Python。
- 预置工作流是第一执行路径（确定性、可审查、可版本化）。
- AI 可选：自然语言选流程/填参数；未覆盖的场景走 Agent 兜底。
- 企微群发「给全部群组发 1」是验收用例。
- 保留现有安全不变量：名单冻结、标题完整、唯一发送、发送后回读、不重试、歧义即停。

**不做（MVP）**
- 不做虚拟屏/无线调试助手；
- 不做 Linux 沙箱；
- 不做内置浏览器/CDP；
- 不做 MCP/CLI；
- 不做多模型账号 OAuth 登录。

### 4.2 关键决策：前台优先，虚拟屏后置

| 方案 | 优点 | 代价 | 建议 |
|---|---|---|---|
| **A. 前台无障碍** | 装完即用；不需要无线调试；OEM 兼容性最好；实现简单 | 任务期间占用屏幕；不能边用手机边跑 | **MVP 选它** |
| **B. 虚拟屏 + shell 助手**（Mika） | 不占屏幕；可并行；任务结束 App 留在后台 | 需一次配对；隐藏 API；OEM 差异；权限面大；实现重 | 后续可选 |
| **C. 混合** | 前台兜底 + 后台增强 | 两套实现要维护 | 接口抽象好后再加 |

**结论**：先把 `UiPort` 做成接口，前台无障碍实现；工作流/Agent 只依赖 `UiPort`。以后加虚拟屏实现，不改上层。

### 4.3 推荐架构

```
┌──────────────────────────── 单个 APK ────────────────────────────┐
│ UI (Compose): 工作流 / 聊天 / 运行记录 / 设置                     │
│                                                                  │
│ WorkflowEngine (确定性)          AgentLoop (可选 AI)              │
│   ├─ params/slots                 ├─ 模型客户端                   │
│   ├─ selector + verify            ├─ 工具集                       │
│   ├─ per-recipient loop           └─ 异常兜底/自然语言              │
│   └─ pre/post hooks                                               │
│                    ↓ 共用                                         │
│ UiPort: snapshot / find / tap / type / key / scroll / launch      │
│   ├─ AccessibilityService (读 + 手势)                             │
│   ├─ PorInput IME (兜底输入)                                      │
│   └─ (可选 Phase 4) Helper + 虚拟屏                               │
│                                                                  │
│ Scheduler (AlarmManager + 前台服务) / Store / Keystore            │
└──────────────────────────────────────────────────────────────────┘
```

**模块划分**

```
android/
  core/                    # 纯 Kotlin/JVM，可单测
    workflow/              # 模型、校验、执行器、选择器、结果
    ui/                    # UiPort、UiSnapshot、UiElement、Selector
    agent/                 # AgentLoop、工具注册、提示词
    model/                 # OpenAI-compatible / Anthropic / Gemini
    trigger/               # 调度定义、账本
    store/                 # 工作流、配置、运行记录、凭据引用
  app/                     # Android
    ui/                    # Compose
    a11y/                  # AccessibilityService、ScreenReader
    input/                 # IME 兜底（复用 native/android-input）
    service/               # 前台服务、任务中心、通知
    scheduler/             # AlarmManager / WorkManager
    store/                 # 文件、Keystore
```

**核心接口（建议设计，不是 Mika 现有接口）**

```kotlin
interface UiPort {
    suspend fun snapshot(): UiSnapshot
    suspend fun tap(selector: Selector, snapshotId: String): ActionResult
    suspend fun type(selector: Selector, text: String, snapshotId: String): ActionResult
    suspend fun key(keyCode: Int): ActionResult
    suspend fun back(): ActionResult
    suspend fun scroll(direction: Direction, amount: Int): ActionResult
    suspend fun launch(packageName: String): ActionResult
    suspend fun waitFor(predicate: ScreenPredicate, timeoutMs: Long): Boolean
}

data class UiSnapshot(
    val id: String,
    val packageName: String?,
    val elements: List<UiElement>,
    val protected: Boolean,
    val hash: Long,
)

data class UiElement(
    val ref: String,
    val role: String,
    val name: String,
    val resourceId: String?,
    val bounds: List<Int>, // 0..999
    val clickable: Boolean,
    val editable: Boolean,
    val scrollable: Boolean,
    val hint: Boolean,
    val secret: Boolean,
)

sealed interface ActionResult {
    data class Ok(val changed: Boolean, val snapshotId: String) : ActionResult
    data class Diverged(val reason: String, val snapshotId: String?) : ActionResult
    data class NeedsUser(val reason: String) : ActionResult
}
```

### 4.4 预置工作流设计

#### 4.4.1 格式

以下是 **por-auto 新 APK 的建议格式**，不是 Mika 现有格式（Mika 的 Route 结构见附录 B）。沿用现有 `workflows/<id>/workflow.json` 的结构，增加 `params`、`expect`、`on_divergence`：

```json
{
  "schemaVersion": 2,
  "id": "wecom-broadcast",
  "name": "企业微信批量发送",
  "version": "2.0.0",
  "package": "com.tencent.wework",
  "params": {
    "text": { "type": "string", "min": 1, "max": 4000, "required": true },
    "scope": { "type": "enum", "values": ["direct", "groups", "both"], "default": "groups" }
  },
  "steps": [
    {
      "id": "launch",
      "type": "launch",
      "package": "com.tencent.wework",
      "expect": "home"
    },
    {
      "id": "broadcast",
      "type": "wecom.broadcast",
      "scope": "{{scope}}",
      "text": "{{text}}",
      "on_divergence": "stop"
    }
  ]
}
```

说明：
- `params` 在执行前校验；UI 自动生成表单；AI 只填这些参数。
- `type` 分两类：
  - **通用 UI 动作**：`launch`/`wait`/`tap`/`type`/`back`/`scroll`/`read`；
  - **App 宏**：`wecom.broadcast`/`wecom.open_chat`/`wecom.read_list`。
- 宏用 Kotlin 实现，内部仍是通用 UI 动作 + 校验；JSON 保持简单、可审查。
- `on_divergence`：`stop`（默认，发送类）/ `agent`（只读类可交给 AI）。

#### 4.4.2 执行语义

1. **校验参数**：schema、长度、范围；不合格直接拒绝，不启动。
2. **前置 Hook**（可选）：HTTP 取消息/名单；失败不运行。
3. **启动 App + 等待首页**：核对包名、首页标志节点。
4. **枚举名单**：按分类逐屏读取到确定末尾；冻结完整名单；分类内同名/列表变化/无法确认末尾 → 停止。
5. **逐个处理**：
   - 打开会话；
   - 核对完整标题（不允许省略号补全、不允许删数字前缀）；
   - 写入文字（`ACTION_SET_TEXT` 或 IME）；
   - 完整回读草稿，必须与目标文字一致；
   - 点击「发送」一次；
   - 回读发送气泡 + 同一行唯一右侧头像；
   - 记录逐对象结果；
   - 返回列表。
6. **任何歧义/缺失/回读不一致**：停止后续发送，标记 `needs_review`，不自动重试。
7. **后置 Hook**（可选）：回传本次状态；失败只记录，不重跑手机动作。
8. **汇总**：成功/失败/不确定数量，导出 JSON。

**关键不变量**
- 名单冻结后才开始发送；
- 发送动作只点一次；
- 不自动重发；
- 发送成功只代表界面已出现消息，不代表网络送达；
- 不确定的结果标 `uncertain`，不冒充成功。

#### 4.4.3 选择器

沿用现有语义，并补资源 ID：

```json
{
  "text": ["群聊"],
  "prefix": ["群聊"],
  "resourceId": "com.tencent.wework:id/xxx",
  "role": "android.widget.TextView",
  "peers": ["发送"],
  "bottom": false
}
```

- `text` / `prefix` 至少一项；
- `peers` 要求同一行出现指定文字；
- `bottom` 只在屏幕底部找；
- **唯一匹配才点击**；歧义停止，不猜坐标；
- 资源 ID 按企微版本映射（现有 `wecom-ids.js` 已有 5.0.12 的 profile，可直接移植）。

#### 4.4.4 工作流商店

- 复用现有 `workflows/registry.json` + GitHub 源；
- APK 内置默认 4 个企微工作流；支持本地导入；
- 版本固定、SHA-256、安装/更新/卸载；
- 运行记录带工作流版本和 Git 提交。

### 4.5 AI 层

#### 4.5.1 三种模式

| 模式 | 行为 | 成本 | 建议 |
|---|---|---|---|
| `workflow` | 只跑预置流程，不调模型 | 0 | 默认 |
| `assistant` | 模型把自然语言映射到 `{workflowId, params}`，再跑预置流程 | 一次小调用 | 推荐默认 AI 模式 |
| `agent` | 模型直接调 UI 工具，处理未覆盖场景 | 多次调用 | 高级开关 |

**核心原则：预置流程与 AI 解耦。** AI 不可用、没网、没 Key，工作流卡片照样能跑。

#### 4.5.2 自然语言 → 工作流

1. 先用本地规则/关键词匹配（`给.*群.*发`、`发.*给.*`、`总结.*群`）；
2. 不确定再调一次小模型，输出：

   ```json
   { "workflowId": "wecom-broadcast", "params": { "scope": "groups", "text": "1" } }
   ```

3. 代码校验：工作流存在、params 符合 schema、文字长度、目标范围；不合格就追问。
4. 例子：
   - 「给全部群发 1」→ `wecom-broadcast`, `{scope:"groups", text:"1"}`
   - 「给张三发 1」→ 单聊工作流，或 `wecom.open_chat` + `chat_send_text`
   - 「总结一下群消息」→ 只读工作流/Agent

#### 4.5.3 Agent 工具

| 工具 | 说明 |
|---|---|
| `ui_read` | 读当前屏，返回元素列表 + snapshotId |
| `ui_find` | 按文字/资源 ID/角色查元素 |
| `ui_tap` | 按 ref 点击；必须带 snapshotId |
| `ui_type` | 向输入框写文字；回读校验 |
| `ui_key` / `ui_back` | 按键/返回 |
| `ui_scroll` | 滚动 |
| `app_launch` / `app_wait` | 启动/等待 |
| `workflow_list` / `workflow_run` | 列出/运行预置工作流 |
| `ask_user` | 信息不足时问 |
| `done` | 结束并报告 |

**Agent 限制**
- 默认只允许 `com.tencent.wework`；
- 写动作前必须唯一匹配；
- 发送类动作只允许通过 `wecom.broadcast` 宏，Agent 不能自己点「发送」；
- 最大步数、无进展、重复动作守卫；
- 任何歧义停止。

#### 4.5.4 模型接入

- 首选 OpenAI-compatible（DeepSeek/Qwen/Kimi/GLM/OpenRouter/Ollama/LM Studio）；
- 再加 Anthropic/Gemini；
- OkHttp + kotlinx.serialization；流式；超时/重试/错误分类；
- Key 用 Keystore 加密；不写日志；不上传屏幕，除非用户选择视觉模型；
- 不做 OAuth 登录（Mika 支持 ChatGPT/xAI/OpenRouter 登录，复刻成本高、收益低）。

#### 4.5.5 提示词与安全

- 系统提示：角色、当前 App 知识、可用工作流目录、安全不变量、工具使用规则、停止条件。
- 每次工具结果都带 `snapshotId` 和 `changed`；模型不能凭记忆猜坐标。
- 只读/写分离；写动作前确认目标唯一；发送类只点一次。
- 允许包名单（默认 `com.tencent.wework`）；Agent 默认不能操作其他 App，除非用户显式开启。

### 4.6 企微群发端到端

**预置流程（推荐）**

```
用户点「企业微信批量发送」卡片
  → 选 scope=groups，填 text=1
  → 校验参数
  → 启动企微，等首页
  → 打开「群聊」分类
  → 逐屏读取群名，直到末尾；冻结名单
  → for each 群：
      打开群 → 核对完整标题 → 写「1」→ 回读草稿 → 点发送一次 → 回读气泡 → 记录 → 返回
  → 汇总：成功 N / 失败 M / 不确定 K
```

**AI 入口（可选）**

```
用户说「给全部群发 1」
  → 规则/模型解析为 {workflowId:"wecom-broadcast", params:{scope:"groups", text:"1"}}
  → 校验
  → 走上面的预置流程
```

**失败语义**

| 情况 | 行为 |
|---|---|
| 名单枚举不完整 | 停止，不发送 |
| 分类内同名 | 停止，要求人工处理 |
| 标题不完整/带省略号 | 停止，不进入 |
| 已有草稿 | 停止，不覆盖 |
| 输入回读不一致 | 停止，不发送 |
| 发送后回读不到 | 标记 `uncertain`，不重发 |
| 中途锁屏/企微被切走 | 等待；超时停止 |
| 工作流版本与企微版本不匹配 | 停止，提示更新映射 |

### 4.7 调度

- `AlarmManager.setExactAndAllowWhileIdle`（有权限时）+ WorkManager 兜底；
- 前台服务类型：`specialUse`（说明子类型）或 `dataSync`（注意 Android 15 每日限额）；
- 通知权限、精确闹钟权限、电池白名单引导；
- `TriggerStore` + `TriggerWindow` 账本，避免重复执行；
- 错过的时间点合并成一次，不补跑风暴；
- 忙时跳过或稍后重查（`idleOnly`）；
- 时区按 IANA；跨时区/夏令时用 `ZonedDateTime`。

### 4.8 存储与凭据

```
filesDir/
  workflows/<id>/workflow.json
  workflow-store.json          # 已安装版本、来源、SHA-256
  configs/<id>.json            # 每个工作流的配置（消息、范围、Hook）
  schedules.json               # 定时定义
  triggers.json                # 触发账本
  runs/<runId>.json            # 运行记录
  logs/<runId>.log             # 有限日志
```

- 凭据（HTTP Token、模型 Key）用 Android Keystore 加密，配置文件只存引用；
- 不写明文到日志；
- 运行记录脱敏（手机号、消息正文可配置）。

### 4.9 工程结构

```
android/
  settings.gradle.kts
  gradle/libs.versions.toml
  core/
    src/main/kotlin/...
    src/test/kotlin/...
  app/
    src/main/AndroidManifest.xml
    src/main/java/...
    src/main/res/...
  ime/                         # 可选：复用 native/android-input 的 IME
```

- `core` 不依赖 Android，工作流/选择器/调度数学/模型客户端都能 JVM 单测。
- `app` 只做 Android 适配和 UI。
- 现有 `native/android-input` 可以直接作为 `ime` 模块迁入，或保持独立 APK 由主 APK 绑定。

### 4.10 复用与弃用清单

**直接复用**
- `workflows/*/workflow.json` 的 schema、registry、校验规则；
- `mobile-workflows/wecom-suite/src/wecom.js` 的企微选择器、名单枚举、发送/回读逻辑；
- `mobile-workflows/wecom-suite/src/wecom-ids.js` 的版本映射；
- `native/android-input` 的 IME；
- HTTP 前后置 Hook、Cron 语义、运行记录格式；
- 现有安全不变量和文档。

**逐步弃用（APK 路径）**
- Go 桌面宿主、ADB 设备发现、uiautomator2；
- AutoJs6 运行时（保留作为旧版过渡）；
- Rust 残留；
- 视觉/OCR 路径（保留可选）。

**不复制**
- Mika 的虚拟屏助手（Phase 4 再评估）；
- Linux 沙箱；
- 内置浏览器/CDP；
- MCP/CLI；
- 多模型账号 OAuth。

### 4.11 分阶段计划

| 阶段 | 内容 | 产出 | 估算 |
|---|---|---|---|
| P0 ✅ | 空壳 APK + 无障碍读屏 + 节点导出（`android/`，可拖动悬浮读屏按钮） | 已在 vivo X21 / Android 9 / 企微 5.0.12 验证首页、群聊列表、会话页 | 已完成 |
| P1 ✅ | 企微群发（试运行 + 正式发送）+ 运行记录，范围固定全部群聊 | vivo X21 真机试运行 + 真发「1」通过 | 已完成 |
| P2 ✅ | 调度 + 前台服务 + 通知 | vivo X21 定时 23:22 自动发送成功 | 已完成 |
| P3 🚧 | AI 配置（OpenAI/Anthropic 兼容、Base URL、Key、Fetch models、测试）+ 一句话生成消息 | 本地网关全程验证通过；通用 Agent 路由未做 | 部分完成 |
| P4 | 虚拟屏助手（可选） | 后台操作 | 3–6 周 |
| P5 | 商店/导入导出/打磨 | 可交付 | 3–5 天 |

> 估算是单人、熟悉 Android、含真机联调，不含应用商店审核。P0–P2 是 MVP；P3 是增强；P4 只在确有必要时做。

**MVP 验收标准**
- 真机安装 APK，开启无障碍；
- 企微已登录，测试群可见；
- 运行「给全部群组发 1」；
- 名单冻结、逐对象结果、无重复发送、歧义停止；
- 杀进程/锁屏/切走时行为符合预期；
- 发送后回读能区分成功/不确定。

### 4.12 风险与验证

| 风险 | 影响 | 缓解 | 验证 |
|---|---|---|---|
| 企微版本改资源 ID | 选择器失效 | 版本映射 + 自检 + 歧义即停 | 每个企微版本跑一遍四个工作流 |
| OEM 无障碍差异 | 读不到/点不动 | 前台方案 + 机型矩阵 + 自检 | 至少 2 个品牌真机 |
| 输入法/输入框 | 写不进/回读不一致 | `ACTION_SET_TEXT` + 自带 IME + 回读 | 真机输入中文/表情/长文本 |
| Android 13+ 受限设置 | 无障碍打不开 | 引导「允许受限制的设置」；后续助手代开 | 全新安装走一遍 |
| 精确闹钟/前台服务限制 | 定时不准/被杀 | 权限引导 + WorkManager 兜底 + 电池白名单 | 锁屏/杀进程/重启后各测一次 |
| 误发/重复发 | 业务事故 | 名单冻结 + 唯一发送 + 不重试 + 回读 | 故障注入测试 |
| 模型幻觉/误操作 | 误点/误发 | 工作流主路径 + 允许包名单 + 写前确认 | Agent 只读模式先跑 |
| 合规/ToS | 封号/法律风险 | 用户授权、限速、不做规避检测 | 法务/业务确认 |

---

## 5. 建议的下一步

1. **先做 P0**：一个空壳 APK，只做无障碍读屏和节点导出，确认目标企微版本能读到标题、列表、输入框、发送按钮。
2. **再做 P1**：把 `wecom-broadcast` 从 JS 迁到 Kotlin，先跑通「给测试群发 1」，再扩到全部群组。
3. **P2 之前不要碰 AI**：确定性流程没跑稳，AI 只会放大不确定性。
4. **P3 再引入 AI**：先做 `assistant` 模式（自然语言选流程/填参数），不要一上来做通用 Agent。
5. **P4 虚拟屏**：只有当「任务期间不能占用屏幕」成为硬需求时再做；否则前台方案足够。
6. **不要重写企微规则**：现有 `wecom.js` 的选择器、名单枚举、发送/回读是金标准，逐条迁移，不凭记忆重写。

---

## 6. P0 实现进展（2026-11-01）

已在仓库新增 `android/`，包名 `com.por.auto.agent`，minSdk 26 / target 35：

- `AgentAccessibilityService`：读当前屏、提供 `TYPE_ACCESSIBILITY_OVERLAY` 悬浮「读屏」按钮（可拖动）；
- `ScreenReader`：无障碍树归一化为 `UiElement`，带 `ref` / `parentRef` / `actionRef` / `editRef` / 归一化 bounds / `clickable` / `editable` / `secret`；
- `SnapshotJson`：可读 JSON，含窗口类型、包名、控件数；
- `CaptureRunner` + `DumpStore`：落盘到 `filesDir/dumps/latest.json`，保留最近 50 份；
- Compose 界面：无障碍状态、悬浮按钮开关、通知备用入口、最近一次 JSON 的复制/分享；
- 单元测试：坐标归一化、FNV 指纹、去重键。

验证：

- `./gradlew :app:testDebugUnitTest :app:assembleDebug` 通过；
- `./gradlew :app:lintDebug` 通过；
- Android 14 模拟器：开启无障碍 → 显示悬浮按钮 → 打开系统设置 → 点「读屏」→ 读到 `com.android.settings` 30 个控件，`actionRef` 正确指向可点击行；
- 真机 vivo X21 / Android 9 / 企微 5.0.12：
  - 消息首页 76 个控件，读到「全部 / 消息 / 通讯录 / 工作台 / 我」；
  - 群聊列表 43 个控件，读到群名 `ajfjfjfh`；
  - 会话页 27 个控件，标题 `ajfjfjfh(1)`，输入框 `com.tencent.wework:id/iu5`（editable），消息正文 `ith`，头像 `j3b`；
  - 资源 ID 与现有 `wecom-ids.js` 的 5.0.12 映射一致；输入框为空时没有「发送」按钮，属正常；
  - 悬浮按钮可拖动，拖动后轻点仍能读屏。

未验证：

- 点击/输入/滚动（P1）；
- 输入文字后的「发送」按钮节点（P1 再验证）；
- 通知栏备用入口在部分系统上可能读到通知栏本身。

## 7. P1 实现进展（2026-11-01）

在 `android/app/src/main/java/com/por/auto/agent/wecom/` 实现：

- `WecomTree`：只读企业微信聚焦窗口的原始无障碍树（保留容器和父链），按资源 ID 找控件、沿父链找可点击行；节点失效重读，`安全保护中` 直接停。
- `WecomIds`：版本映射（5.0.12），未收录版本直接拒绝运行，避免错点。
- `WecomTitle`：标题比对，允许群标题 `(成员数)` 后缀，出现省略号一律不认。
- `WecomActions`：坐标点击（`dispatchGesture`）、`ACTION_SET_TEXT` 写入、返回、启动企微。
- `WecomBroadcastRunner`：回首页 → 切群聊 → 冻结名单 → 逐个打开并核对标题 → 已有草稿即停 → 写入并回读 → 试运行清理 / 正式发送只点一次并回读气泡 → 失败即停、不重发。
- `RunStore`：运行记录落 `files/runs/`，App 重启后仍能看到上次结果。

真机（vivo X21 / Android 9 / 企微 5.0.12）试运行结果：

- 名单冻结 1 个群 `ajfjfjfh`；
- 打开会话、标题核对 `ajfjfjfh(1)` 通过；
- 写入 `1` 并回读通过；
- 清理草稿后输入框回到提示语，会话内没有新增消息；
- 运行记录：`status=rehearsed, completed=1, failed=0`。

正式发送（2026-11-01 23:03）结果：

- 只点击一次发送，回读输入框清空并出现新的右侧头像气泡；
- 会话里只有一条新的「1」，没有重复；
- 运行记录：`dryRun=false, completed=1, failed=0`；
- 发送后企业微信自行弹出过一次「风险提醒」网页（该群有历史外链）；P1 只点击了发送按钮，未点击链接。

已知边界：只发群聊、只支持 5.0.12、单机前台运行、无 AI 路由、无定时。

## 8. P1–P3 落地与仓库调整（2026-11-02）

仓库结构调整：旧的 Go 桌面端、AutoJs6 脚本、工作流 Registry、构建脚本全部移入 `archive/`；
`android/` 成为唯一交付主线，`docs/` 放方案文档，根 README 重写。

P1 群发：`wecom/` 下的 `WecomTree`（原始无障碍树 + 父链）、`WecomIds`（5.0.12 版本映射）、
`WecomTitle`（标题比对）、`WecomActions`（手势点击 / ACTION_SET_TEXT / 返回 / 启动）、
`WecomBroadcastRunner`（回首页 → 切群聊 → 冻结名单 → 逐个打开 → 核对 → 试运行清理 / 正式发送回读）。

P2 定时：`schedule/` 下的 `Schedule`（每日钟点 + 下次触发计算）、`ScheduleStore`、`AlarmScheduler`
（精确闹钟优先，否则不精确）、`ScheduleReceiver` + `BroadcastService`（前台服务执行，锁屏或无障碍未开时跳过并记录）、
`BootReceiver`（开机重排）。

P3 AI：`ai/` 下的 `AiConfigStore`（Keystore AES-GCM 加密 Key）、`AiClient`（OpenAI 兼容 / Anthropic 兼容）、
`AiParsing`（纯解析函数，可单测）。界面在设置页：选协议、填 Base URL / Key、获取模型、保存并测试；
群发页多一个「AI 生成」把一句话变成消息正文。明文 HTTP 只放行本机回环。

真机验证（vivo X21 / Android 9 / 企微 5.0.12）：

- 试运行连续 2 次通过；正式发送一次成功，会话内只有一条新消息；
- 定时 23:22 到点自动执行并发送，随后推进到次日；
- AI：本地网关取到 11 个模型，「保存并测试」返回可用，「AI 生成」成功填入消息。

已知未做：通用 Agent 路由（自然语言直接操作界面）、企微版本之外的映射。

## 9. 范围选择、断点续跑与 AI 填表（2026-11-02）

- **范围三选一**：`WecomScope` 带标签与序列化 key（groups / direct / both）。群聊读「群聊」分类；
  全部读「全部」分类；单聊没有独立分类，先冻结群聊名单，再从「全部」里按完整名称排除群会话，
  同时沿用原有的固定排除项（客户联系、企业微信团队等）。分类页名统一由 `WecomScope.page` 给出，
  避免各处各写一遍。
- **断点续跑**：一次运行在首个失败处停下，失败的会话和未执行的会话会存成 `ResumeJob`
  （正文、范围、模式、剩余名称）。续跑只处理这份名单：名单里已经找不到的会话直接报错停下，
  不把「少发一个」当成功。只有覆盖全部收件人的试运行才授权正式发送；正式发送不推翻已有试运行结论。
- **AI 填表**：`AiClient.plan` 用一段 JSON 约定让模型把一句话变成正文 + 范围，
  `AiParsing.plan` 负责抠 JSON、丢弃无效范围、空正文报错。AI 只填表，不点任何按钮，
  仍需用户自己试运行和确认发送。

真机（vivo X21 / 企微 5.0.12）验证：群聊范围续跑与单聊/全部范围待重跑。

## 10. 通用助手与跨版本定位（2026-11-02）

**结构定位，不再锁版本。** `WecomLayout` 只用界面结构找控件：列表取最大的可滚动区、输入框取
唯一可编辑控件、会话标题取顶部区域最靠上的文字、行标题取行内第一个非纯数字文字、头像取右半边
的图片节点。资源 ID 只在已收录版本上作为提示（命中就用，没命中就退回结构）。`WecomIds.forVersion`
对未知版本返回 null，群发照常运行并在日志里写明「未收录版本，按界面结构定位」。所有 finder
要求唯一，两个候选分不清就停下，不猜。

**通用助手。** 新增「助手」标签：一句话目标 → 读当前屏 → 模型给一个 JSON 动作 → 执行 → 再看一眼。
动作只有 `tap / input / back / scroll / wait / open / done / stop` 八种；Index 来自屏幕清单，
清单不包含密码框。护栏：删除/退出/支付这类目标里没提到的操作直接拦下；界面连续两步没变化停；
同一个动作重复 4 次停；有密码输入框停；用户随时可以点停止。**不设步数上限**，靠上面这些护栏兜底。

**参考。** phongent（`mylea1/phongent`，Mika 的多设备版本）证明同一件事：agent 不该依赖固定资源 ID，
而是每一步读实时控件清单再决定动作；它的知识库是自然语言的 App 说明，不是版本映射表。

## 附录 A：Mika 工具清单

**通用**：`wait`、`view_past_screens`、`view_user_screen`、`ask_user`、`request_confirmation`、`hand_to_user`、`handle_obstacle`、`end_not_done`、`knowledge_search`、`knowledge_read`、`skill_search`、`skill_read`、`skill_save`、`memory_search`、`memory_save`、`profile_edit`、`schedule_task`、`spawn_agent`。

**手机屏幕**：`observe`、`list_elements`、`screenshot`、`describe`、`find_visually`、`tap`、`scroll`、`swipe`、`type_text`、`clear_text`、`back`、`press_key`、`diagnose`、`phone_find`、`phone_extract`、`phone_collect`、`phone_wait`、`phone_gesture`。

**手机 App/系统**：`phone_launch_app`、`phone_list_apps`、`phone_share_text`、`phone_app_after_task`、`phone_set_alarm`、`phone_set_timer`、`phone_show_alarms`、`phone_add_calendar_event`、`phone_system_command`、`phone_dialog`、`open_link`。

**网页**：浏览器/页面读取、点击、输入、下载、上传等（本方案不复制）。

**沙箱**：命令/脚本/文件（本方案不复制）。

---

## 附录 B：Mika 路线 JSON 结构

```json
{
  "id": "uuid",
  "template": "给{1}发{2}",
  "slots": 2,
  "packages": ["com.tencent.mm"],
  "appVersions": {},
  "steps": [
    {
      "tool": "phone_launch_app",
      "argsJson": "{\"package\":\"com.tencent.mm\"}",
      "target": null,
      "before": { "packageName": "com.tencent.mm", "texts": ["微信"] },
      "after": { "packageName": "com.tencent.mm", "texts": ["通讯录"] }
    },
    {
      "tool": "phone_tap",
      "argsJson": "{}",
      "target": {
        "role": "android.widget.TextView",
        "name": "{1}",
        "resourceId": null,
        "bounds": [0, 100, 500, 160],
        "ordinal": 0,
        "uniqueAtRecord": true
      },
      "before": { "packageName": "com.tencent.mm", "texts": ["搜索"] },
      "after": { "packageName": "com.tencent.mm", "texts": ["发送"] }
    }
  ],
  "successes": 0,
  "consecutiveMisses": 0,
  "missStep": null,
  "disabled": false,
  "lastUsedMs": 0
}
```

---

## 附录 C：参考资料

- Mika README：`https://github.com/wangzan101/mika`
- 设置指南：`docs/setup-guide.md`
- 能力说明：`docs/features.md`
- 模式：`docs/modes.md`
- MCP：`docs/mcp.md`
- CLI：`docs/cli.md`
- por-auto 现有工作流：`workflows/README.md`
- por-auto 手机工作流：`mobile-workflows/README.md`
- por-auto 原生验收：`outputs/2026-10-22-native-only-validation.md`
