# 单机手机 AI 助手：Mika 二次开发与 SDK 源码复核

核对日期：2026-11-11。以下是固定提交的静态源码分析，未编译上游、未安装 APK、未在真机运行；没有把 `archive/` 旧栈作为 APK 参考来源。

用户补充的目标是：做一个类似 Mika 的 APK，通过自然语言让 AI 操作当前手机，并增加自己的功能；不需要多设备控制。目前只调研，不迁移项目、不改 APK 实现。

**据此调整建议：优先评估直接基于 Mika 二次开发。** 最终选择主要取决于目标手机系统版本，以及是否继续要求「只有前台无障碍、不使用 shell helper / 虚拟屏」；详见第 5 节。

| 上游 main 快照 | 固定提交 | 提交时间（UTC） |
| --- | --- | --- |
| wangzan101/mika | [`8bd8d4be7c3dcad2183dfbf4e9b7143c4a626049`](https://github.com/wangzan101/mika/commit/8bd8d4be7c3dcad2183dfbf4e9b7143c4a626049) | 2026-11-11 13:14:09 |
| mylea1/phongent | [`cb58c10425a870d189ef39b8cc3dd1c8e8155d3e`](https://github.com/mylea1/phongent/commit/cb58c10425a870d189ef39b8cc3dd1c8e8155d3e) | 2026-11-02 13:21:12 |

phongent 明确基于 Mika，增加 iOS/Android 主控与多设备协同；不能把它的 Android `core/agent` 当成与 Mika 无关的另一套 SDK。[项目定位与来源][P-origin]

## 1. 模型接入：自写协议适配器，没有通用 LLM SDK

两项目 Android core 的模型基础依赖是 **OkHttp + kotlinx.serialization + Coroutines**；本次检查的依赖与适配器未引入 Koog、ADK、Vercel AI SDK 等通用 Agent SDK。[Mika 依赖][M-deps]、[phongent 依赖][P-deps]

Mika 自定义 `ChatModel.complete(system, messages, tools)` 与 `StreamingChatModel.completeStreaming(...)`，不同协议统一返回 `ModelReply`。流式文字回调只提供可见正文，不包含私有思考或工具参数。[接口][M-chat]

| 协议 | 源码实现与边界 |
| --- | --- |
| OpenAI Chat Completions compatible | 自拼 `/chat/completions` 请求，传 `tools`、解析 `tool_calls`；自行累积 SSE 工具参数，流结束后形成完整调用。[Mika 请求][M-openai]、[流解析][M-openai-stream]；phongent 同样自持 OkHttp 的适配器。[phongent 实现][P-openai] |
| Anthropic Messages | 自拼 `/v1/messages`，处理原生 `tool_use`、思考签名与 `input_json_delta`。[适配器入口][M-anthropic]、[事件解析][M-anthropic-stream] |
| Gemini generateContent | 自建原生请求及 `functionDeclarations`，统一 `functionCall`、`functionResponse` 和调用编号。[请求][M-gemini]、[工具消息转换][M-gemini-tools] |
| OpenAI Responses | 自写 SSE 适配器；工具结果回传 `function_call_output`，不依赖官方客户端替它维护 Agent 循环。[实现][M-responses] |

因此，**参考项目能运行不构成“必须先引入 AI SDK”的证据**。它们把模型协议层与手机执行层分开；SDK 最有可能减少的是协议、消息、流式和工具 schema 的维护量，这是从上述边界得到的工程判断。

## 2. AgentLoop：闭环由项目代码负责

以 phongent 固定快照追踪调用链，Mika 具有对应实现，但两者当前提交并不完全相同：

| 部件 | 实际职责 |
| --- | --- |
| `AgentLoop` | 维护模型消息历史，调用模型后执行工具；每轮执行首个工具调用，将成功/失败、`guard`、`advice` 和观察引用写成 `Role.Tool` 消息供下一轮使用。[调度契约][P-loop-contract]、[结果回灌][P-loop-feedback] |
| `RetryPolicy` | 对结构化 `ModelError` 分类；429、5xx、网络错误可重试，Key、额度、其他 4xx、解析错误不按暂时故障重试。默认最多重试 3 次，处理 `Retry-After`、指数退避和抖动，并限制单任务累计等待 5 分钟。[phongent 策略][P-retry]。Mika 当前还把流中断、暂时不可达代理纳入可重试范围。[Mika 新增分类][M-retry] |
| `GuardRules` / `StuckAdvice` | 守卫提供重复动作 3/6/12、无效果 3/6/9/12、连续失败 2/4/8 等阶梯；`StuckAdvice` 只组织给模型的建议，进展时重置提醒记账，从第二次卡住类提醒起建议换路或如实放弃。[阶梯][P-guards]、[建议生成][P-stuck] |
| `StopRules` | 将守卫停止、模型错误、主动放弃、步数耗尽等转成不同 `TaskState`；不承担界面观测或业务成功判断。[实现][P-stop] |
| `OutcomeJudge` | **回答交给用户之后**，拿用户要求、最终回答和少量历史让模型分类 `done / partial / not_possible / unknown`。调用时工具列表为空，也没有传入新屏幕或执行账本；它是事后语义评估，不能证明消息确已送达或整项业务确已完成。[输入与调用][P-outcome]、[产品调用位置][P-settle] |

动作核验在更低一层：`ScreenSession.withEffect` 使用动作前后的界面、端口事实和画面差异计算 `effect`；没变化时等待并重读一次，再把 `changed`、原因和提示返回模型。这比单纯 hash 对比更完整，仍只是动作效果证据。[实现][P-effect]

还要区分 **`AnswerReview` 与 `OutcomeJudge`**：前者存在读取证据、必要时用独立核查模型检查最终回答的路径；但 phongent 的实际 Android `TaskRun` 构造器明确传 `reviewFinalAnswer = false`，Mika 当前产品路径也如此。产品循环只在最近动作尚未读回时先要求读屏，再整理出处交出回答；不能因为仓库有核查类，就声称默认对每次任务都做独立最终验证。[可选核查][P-review]、[phongent 产品配置][P-product]、[Mika 产品配置][M-product]、[收尾前读屏][P-last-read]

## 3. Mika 的 App、helper、虚拟屏和无障碍边界

| 层 | 实际职责与证据 |
| --- | --- |
| Android App / core | Compose 外壳与任务服务承载模型、循环及工具；核心按能力提供端口，普通模型 SDK 不会自动提供 Android 输入执行权。[能力组装][M-assembly] |
| shell helper | 通过 `app_process` 加载同一 APK，在 shell uid 2000 的独立进程常驻；负责虚拟屏和特权系统操作。启动命令与 stdin nonce 是项目自己的进程协议。[启动][M-helper]、[helper 服务][M-shell] |
| virtual display | helper 创建虚拟屏；App 侧把 `ImageReader.surface` 交给 helper，再从 ImageReader 拿帧。这是显示与权限适配能力。[建屏][M-create-display]、[取帧][M-display] |
| AccessibilityService | 按 `displayId` 读取无障碍窗口、向指定 display 分发手势。它与 shell helper 各有职责，不能合称成一个“AI 工具调用 SDK”。[窗口与手势][M-a11y] |

工程判断：Koog / ADK 一般 Agent SDK 即使能管理工具循环，仍需项目提供这些 Android 工具实现、权限与生命周期、目标选择、等待稳定、结果读回和业务核验。它们也不会凭 SDK 接入就获得 Mika 的后台屏能力。**前台无障碍优先、虚拟屏后置**是 por-auto 先前采纳的执行路线；用户补充通用助手目标后，应按第 5 节重新比较底座，不在本次研究中实施迁移。

## 4. Route、knowledge、schedules 是可独立取舍的产品能力

| 能力 | 上游实际做法 | 对 SDK 选型的含义 |
| --- | --- | --- |
| Route replay | 从满足学习条件的运行事件记录模板、槽位、选择器和动作前后锚点；回放不逐步问模型，但每步读屏、检查唯一目标、经同一执行入口、核对动作后变化。偏离或需确认就交还模型。[学习条件][M-learn]、[记录][M-record]、[回放][M-replay] | 是与手机 UI 绑定的业务缓存/执行能力，通用 SDK 不会自动生成可靠路线；也不等同手写工作流。 |
| knowledge | `APP.md / SITE.md` 表示包名、域名、别名、说明、可用深链等，作为领域参考材料。[数据契约][M-knowledge] | 是项目知识资产，可交给不同模型接口；没有必要因更换 SDK 丢掉企微结构与 ID 提示。 |
| schedules | 触发定义包含目标、条件、时区、间隔、冷却期；窗口账本区分 claim、派发、送达、失败等状态。[数据与派发契约][M-triggers] | 是调度、持久化和交付语义，不能用模型的 tool loop 替代。 |

上述结论仅确认源码边界。协议兼容性、OEM 后台屏行为、群发业务成功率与设备上的稳定性，仍需各自的集成或真机验证。

## 5. 直接在 Mika 上开发：可以，且应优先评估

### 5.1 单机与前台执行是两件事

Mika 本来就能操作安装它的这台手机。它的虚拟屏也是同一台手机里的后台显示，不是另一台手机。phongent 增加的多设备主控、发现、连接、分组不是本次目标的必要能力。[Mika 产品与设置][M-readme]、[phongent 定位][P-origin]

因此，「不操作其他手机」适合选择 Mika，但并不自动要求删除 Mika 的虚拟屏。要操作用户眼前已经打开的那一屏，或者要取消无线调试的设置流程，则是额外的执行模式要求。

### 5.2 自定义功能的三个入口

| 需要增加的内容 | 优先扩展的位置 | 边界 |
| --- | --- | --- |
| 某个 App 的使用规则、步骤、注意事项 | App knowledge / 用户补充 / skills | 适合教现有工具怎么做；知识或技能本身不会获得新的系统执行能力。[知识注入][M-notes]、[工具装配][M-task-tools] |
| 新的确定性业务流程、接口或手机能力 | 新增工具 / Capability，由现有 dispatcher 与 AgentLoop 调用 | 可把当前企微执行器作为迁移候选；需要适配端口、取消、运行互斥、确认与结果核验，不能直接拷贝后宣称可用。[能力装配][M-assembly]、[工具入口][M-task-tools] |
| 自己的页面、任务记录、更新与服务端集成 | Android App 层和现有任务生命周期 | 在宿主应用层接入产品功能。[任务运行与资源管理][M-task-runtime] |

建议让自己的工具、知识和业务代码有清楚的归属，减少上游核心改动。这是减少后续合并成本的工程建议，不代表 Mika 已提供稳定的二进制插件接口。

### 5.3 两个已经确认的限制

**系统版本。** 固定提交中 `app/build.gradle.kts` 设置 `minSdk = 30`，即 Android 11；README / 设置指南另说明手机 App 操作需要 Android 12 以上，推荐 Android 14 以上。最低能安装与能执行手机任务应分开看。[构建配置][M-app-build]、[使用要求][M-readme]、[设置指南][M-setup]

当前 por-auto 的 `android/app/build.gradle.kts` 为 `minSdk = 26`，现有文档记录的测试设备是 vivo X21 / Android 9。若仍要求支持该设备，Mika 当前版本不能原样安装，不能仅降低 `minSdk` 就视为解决。[当前工程配置](../android/app/build.gradle.kts)、[历史设备记录](2026-11-01-mika-apk-replication-plan.md)

**前台无障碍模式。** Mika 产品的 `TaskRun.connectPhone()` 会依次检查系统版本、取得 shell helper、等待无障碍服务、准备 `LazyAgentDisplay`，再构造 `AndroidScreen`。源码存在 `ScreenPort` 边界，但产品执行路径不是只给当前显示屏改个编号即可替换。[实际连接路径][M-task-runtime]

如果继续坚持「只开启无障碍、操作用户眼前的屏幕」，应另做前台 `ScreenPort` 适配，并核对启动 App、按键、输入、观察、接管与资源释放。是否复用现有 por-auto 执行代码，需要原型验证；本次没有验证这一适配。

### 5.4 路线比较与建议

| 路线 | 适合条件 | 主要成本 |
| --- | --- | --- |
| **直接 fork Mika，加自定义能力** | 目标机满足系统要求，接受其手机操作设置与后台屏 | 学习现有架构、实现业务工具、验证目标 App、维护上游合并；最接近完整 Mika 的功能目标。 |
| **复用 Mika 核心，适配 por-auto 前台执行层** | 前台无障碍必须保留，或希望探索旧设备支持 | 端口与生命周期适配、系统 API 兼容、业务回归；只是可行方向，尚未证明改造量小。 |
| **继续完善当前自写循环** | 明确接受比 Mika 更窄的能力范围 | 自己补齐结构化工具历史、跨轮上下文、知识技能、路线学习、接管和完整任务状态。 |

按用户目前的通用助手目标，先评估第一条；只有设备或权限要求确实不满足时，再比较第二条。Koog / ADK 暂不作为前置选型，Mika 已有自己的模型接口、协议实现和 Agent 基础设施。最终底座与迁移尚未获选，也没有在当前仓库替换架构。

Mika 使用 Apache-2.0，许可证包含修改、制作衍生作品和分发的授权，以及分发时附许可证、标记改动、保留相关声明与适用 NOTICE 等条件；不包含商标授权。[许可证][M-license]

[M-readme]: https://github.com/wangzan101/mika/blob/8bd8d4be7c3dcad2183dfbf4e9b7143c4a626049/README.md
[M-app-build]: https://github.com/wangzan101/mika/blob/8bd8d4be7c3dcad2183dfbf4e9b7143c4a626049/app/build.gradle.kts#L13-L23
[M-setup]: https://github.com/wangzan101/mika/blob/8bd8d4be7c3dcad2183dfbf4e9b7143c4a626049/docs/setup-guide.md
[M-task-runtime]: https://github.com/wangzan101/mika/blob/8bd8d4be7c3dcad2183dfbf4e9b7143c4a626049/app/src/main/java/com/wangzan101/mika/task/TaskRun.kt#L577-L681
[M-task-tools]: https://github.com/wangzan101/mika/blob/8bd8d4be7c3dcad2183dfbf4e9b7143c4a626049/core/src/main/kotlin/com/wangzan101/mika/core/assembly/TaskTools.kt#L44-L161
[M-notes]: https://github.com/wangzan101/mika/blob/8bd8d4be7c3dcad2183dfbf4e9b7143c4a626049/core/src/main/kotlin/com/wangzan101/mika/core/knowledge/KnowledgeStore.kt#L23-L40
[M-license]: https://github.com/wangzan101/mika/blob/8bd8d4be7c3dcad2183dfbf4e9b7143c4a626049/LICENSE
[P-origin]: https://github.com/mylea1/phongent/blob/cb58c10425a870d189ef39b8cc3dd1c8e8155d3e/README.md#L132-L136
[M-deps]: https://github.com/wangzan101/mika/blob/8bd8d4be7c3dcad2183dfbf4e9b7143c4a626049/core/build.gradle.kts#L31-L43
[P-deps]: https://github.com/mylea1/phongent/blob/cb58c10425a870d189ef39b8cc3dd1c8e8155d3e/core/build.gradle.kts#L12-L20
[M-chat]: https://github.com/wangzan101/mika/blob/8bd8d4be7c3dcad2183dfbf4e9b7143c4a626049/core/src/main/kotlin/com/wangzan101/mika/core/model/ChatModel.kt#L3-L18
[M-openai]: https://github.com/wangzan101/mika/blob/8bd8d4be7c3dcad2183dfbf4e9b7143c4a626049/core/src/main/kotlin/com/wangzan101/mika/core/model/OpenAiCompatModel.kt#L33-L114
[M-openai-stream]: https://github.com/wangzan101/mika/blob/8bd8d4be7c3dcad2183dfbf4e9b7143c4a626049/core/src/main/kotlin/com/wangzan101/mika/core/model/OpenAiCompatModel.kt#L342-L405
[P-openai]: https://github.com/mylea1/phongent/blob/cb58c10425a870d189ef39b8cc3dd1c8e8155d3e/core/src/main/kotlin/com/wangzan101/mika/core/model/OpenAiCompatModel.kt#L23-L78
[M-anthropic]: https://github.com/wangzan101/mika/blob/8bd8d4be7c3dcad2183dfbf4e9b7143c4a626049/core/src/main/kotlin/com/wangzan101/mika/core/model/AnthropicModel.kt#L21-L85
[M-anthropic-stream]: https://github.com/wangzan101/mika/blob/8bd8d4be7c3dcad2183dfbf4e9b7143c4a626049/core/src/main/kotlin/com/wangzan101/mika/core/model/AnthropicModel.kt#L294-L355
[M-gemini]: https://github.com/wangzan101/mika/blob/8bd8d4be7c3dcad2183dfbf4e9b7143c4a626049/core/src/main/kotlin/com/wangzan101/mika/core/model/GeminiModel.kt#L21-L82
[M-gemini-tools]: https://github.com/wangzan101/mika/blob/8bd8d4be7c3dcad2183dfbf4e9b7143c4a626049/core/src/main/kotlin/com/wangzan101/mika/core/model/GeminiModel.kt#L130-L211
[M-responses]: https://github.com/wangzan101/mika/blob/8bd8d4be7c3dcad2183dfbf4e9b7143c4a626049/core/src/main/kotlin/com/wangzan101/mika/core/model/ResponsesModel.kt#L32-L132
[P-loop-contract]: https://github.com/mylea1/phongent/blob/cb58c10425a870d189ef39b8cc3dd1c8e8155d3e/core/src/main/kotlin/com/wangzan101/mika/core/agent/AgentLoop.kt#L88-L97
[P-loop-feedback]: https://github.com/mylea1/phongent/blob/cb58c10425a870d189ef39b8cc3dd1c8e8155d3e/core/src/main/kotlin/com/wangzan101/mika/core/agent/AgentLoop.kt#L597-L646
[P-retry]: https://github.com/mylea1/phongent/blob/cb58c10425a870d189ef39b8cc3dd1c8e8155d3e/core/src/main/kotlin/com/wangzan101/mika/core/agent/RetryPolicy.kt#L6-L49
[M-retry]: https://github.com/wangzan101/mika/blob/8bd8d4be7c3dcad2183dfbf4e9b7143c4a626049/core/src/main/kotlin/com/wangzan101/mika/core/agent/RetryPolicy.kt#L7-L53
[P-guards]: https://github.com/mylea1/phongent/blob/cb58c10425a870d189ef39b8cc3dd1c8e8155d3e/core/src/main/kotlin/com/wangzan101/mika/core/guard/GuardRules.kt#L10-L45
[P-stuck]: https://github.com/mylea1/phongent/blob/cb58c10425a870d189ef39b8cc3dd1c8e8155d3e/core/src/main/kotlin/com/wangzan101/mika/core/agent/StuckAdvice.kt#L20-L42
[P-stop]: https://github.com/mylea1/phongent/blob/cb58c10425a870d189ef39b8cc3dd1c8e8155d3e/core/src/main/kotlin/com/wangzan101/mika/core/agent/StopRules.kt#L10-L71
[P-outcome]: https://github.com/mylea1/phongent/blob/cb58c10425a870d189ef39b8cc3dd1c8e8155d3e/core/src/main/kotlin/com/wangzan101/mika/core/agent/OutcomeJudge.kt#L40-L71
[P-settle]: https://github.com/mylea1/phongent/blob/cb58c10425a870d189ef39b8cc3dd1c8e8155d3e/app/src/main/java/com/wangzan101/mika/task/TaskRun.kt#L880-L900
[P-effect]: https://github.com/mylea1/phongent/blob/cb58c10425a870d189ef39b8cc3dd1c8e8155d3e/core/src/main/kotlin/com/wangzan101/mika/core/uistate/ScreenSession.kt#L357-L414
[P-review]: https://github.com/mylea1/phongent/blob/cb58c10425a870d189ef39b8cc3dd1c8e8155d3e/core/src/main/kotlin/com/wangzan101/mika/core/agent/AnswerReview.kt#L28-L85
[P-product]: https://github.com/mylea1/phongent/blob/cb58c10425a870d189ef39b8cc3dd1c8e8155d3e/app/src/main/java/com/wangzan101/mika/task/TaskRun.kt#L622-L642
[M-product]: https://github.com/wangzan101/mika/blob/8bd8d4be7c3dcad2183dfbf4e9b7143c4a626049/app/src/main/java/com/wangzan101/mika/task/TaskRun.kt#L892-L914
[P-last-read]: https://github.com/mylea1/phongent/blob/cb58c10425a870d189ef39b8cc3dd1c8e8155d3e/core/src/main/kotlin/com/wangzan101/mika/core/agent/AgentLoop.kt#L527-L543
[M-assembly]: https://github.com/wangzan101/mika/blob/8bd8d4be7c3dcad2183dfbf4e9b7143c4a626049/core/src/main/kotlin/com/wangzan101/mika/core/assembly/RunAssembler.kt#L15-L40
[M-helper]: https://github.com/wangzan101/mika/blob/8bd8d4be7c3dcad2183dfbf4e9b7143c4a626049/core/src/main/kotlin/com/wangzan101/mika/core/shell/HelperHandoff.kt#L42-L59
[M-shell]: https://github.com/wangzan101/mika/blob/8bd8d4be7c3dcad2183dfbf4e9b7143c4a626049/app/src/main/java/com/wangzan101/mika/cap/phone/shell/ShellService.kt#L54-L65
[M-create-display]: https://github.com/wangzan101/mika/blob/8bd8d4be7c3dcad2183dfbf4e9b7143c4a626049/app/src/main/java/com/wangzan101/mika/cap/phone/shell/ShellService.kt#L100-L128
[M-display]: https://github.com/wangzan101/mika/blob/8bd8d4be7c3dcad2183dfbf4e9b7143c4a626049/app/src/main/java/com/wangzan101/mika/cap/phone/display/AgentDisplay.kt#L20-L77
[M-a11y]: https://github.com/wangzan101/mika/blob/8bd8d4be7c3dcad2183dfbf4e9b7143c4a626049/app/src/main/java/com/wangzan101/mika/cap/phone/a11y/ScreenAccessibility.kt#L103-L130
[M-learn]: https://github.com/wangzan101/mika/blob/8bd8d4be7c3dcad2183dfbf4e9b7143c4a626049/core/src/main/kotlin/com/wangzan101/mika/core/agent/LearnGate.kt#L5-L21
[M-record]: https://github.com/wangzan101/mika/blob/8bd8d4be7c3dcad2183dfbf4e9b7143c4a626049/core/src/main/kotlin/com/wangzan101/mika/core/replay/RouteRecorder.kt#L13-L89
[M-replay]: https://github.com/wangzan101/mika/blob/8bd8d4be7c3dcad2183dfbf4e9b7143c4a626049/core/src/main/kotlin/com/wangzan101/mika/core/replay/Replayer.kt#L39-L124
[M-knowledge]: https://github.com/wangzan101/mika/blob/8bd8d4be7c3dcad2183dfbf4e9b7143c4a626049/core/src/main/kotlin/com/wangzan101/mika/core/knowledge/Knowledge.kt#L3-L28
[M-triggers]: https://github.com/wangzan101/mika/blob/8bd8d4be7c3dcad2183dfbf4e9b7143c4a626049/core/src/main/kotlin/com/wangzan101/mika/core/trigger/Triggers.kt#L10-L83
