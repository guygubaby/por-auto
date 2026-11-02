# 微信空控件树：原生与视觉后备路径

核对日期：2026-10-20。设备现状来自本次实测记录：vivo X21 / Android 9 / 微信 8.0.79；uiautomator2 和已启用的 AutoJs6 只返回空根，保留 flags、原生查询和重启尚未解决。Hamibot 1.6.7 已安装但服务待开启，不能写成已兼容。本文仅核对官方资料，未操作设备、读取凭据或调用模型。

**建议顺序：Hamibot 做最后一次有界原生验证；仍为空则首选 Open-AutoGLM 按需本地 runner，备选 AI SDK + 现有 Rust ADB 的窄工具视觉 Agent。** 保留 Tauri 客户端，不增加业务服务器。视觉模式必须明确标为「视觉 AI Agent」，不能称为原生控件模式。

## 原生路径的证据边界

Android 要求服务声明 `canRetrieveWindowContent` 才能读 UI hierarchy；服务启用与页面是否提供可用节点是两件事。[Android 官方服务说明](https://developer.android.com/guide/topics/ui/accessibility/service) Hamibot 官方说明它基于 Auto.js、无需 root；`auto.rootInActiveWindow`、`auto.windows`、`auto.windowRoots` 都在无障碍窗口体系内，`normal` 模式不启用快速控件缓存，`setWindowFilter` 能把搜索范围扩展到其他窗口。[Hamibot 仓库](https://github.com/hamibot/hamibot)、[控件文档](https://docs.hamibot.com/reference/widgetsBasedAutomation)

因此剩余原生尝试应限定为：用户开启 Hamibot 服务后，在同一微信页面使用 normal 模式、放开窗口过滤，记录各窗口包名和实际子节点数量；若仍只有空微信根，停止继续更换同类 selector 工具。现有 flags/直接查询已尝试，不再把它们当作新修复。系统朗读服务暂不可用，其影响也未经验证。

此次未找到官方资料证明「Hamibot 1.6.7 能在该设备/微信版本恢复控件树」，也未找到不 root、不降级即可保证修复的办法。空树根因仍未证实；不能断言是微信屏蔽、vivo 限制或服务配置中的哪一项。能启动微信、全局返回或按坐标点击，也不证明原生节点恢复。

## 视觉路线核对

| 路线 | 设备与中文输入 | Provider / 图像 / 本机依赖 | 本项目判断 |
| --- | --- | --- | --- |
| Open-AutoGLM | Android 7+；ADB 截图、坐标点击/滑动/返回，不要求读取微信无障碍树。中文通过 ADB Keyboard 的 UTF-8 Base64 广播输入，需要安装并启用该输入法。[官方 README](https://github.com/zai-org/Open-AutoGLM)、[截图代码](https://github.com/zai-org/Open-AutoGLM/blob/main/phone_agent/adb/screenshot.py)、[输入代码](https://github.com/zai-org/Open-AutoGLM/blob/main/phone_agent/adb/input.py) | Python 3.10+；模型在 API 端，客户端不必下载 9B 权重。配置 `base_url / model_name / api_key`；官方列出 BigModel 的 `autoglm-phone` 及 ModelScope 服务。实际可用性仍需真实请求验证。[配置与部署](https://github.com/zai-org/Open-AutoGLM#readme) | **首选后备**：现成截图→模型→ADB 循环，最直接避开当前空树。需适配本客户端的逐目标日志、取消与不确定发送停止规则；不能裸接 CLI 就宣称群发完成。 |
| DroidRun / 当前 Mobilerun framework | 官方原仓库已重定向到 Mobilerun；标准 AndroidDriver 使用 Portal 的无障碍服务、动作与自带键盘，输入支持 Unicode。提供 `--vision-only` 截图模式，但这不等于取消 Portal 初始化/授权要求。[当前仓库](https://github.com/droidrun/mobilerun)、[设备准备](https://github.com/droidrun/mobilerun/blob/main/docs/guides/device-setup.mdx)、[输入接口](https://github.com/droidrun/mobilerun/blob/main/docs/sdk/adb-tools.mdx) | Python `>=3.11,<3.14`；有 Provider 配置向导和多个模型提供商。视觉任务仍需图像模型与有效鉴权。[官方安装和配置](https://github.com/droidrun/mobilerun#readme) | 不是当前优先项：增加 Portal 和授权，并无该微信版本的兼容证据。另一个官方 **mobile-harness / mobilerun-core** 有「ADB 存在、Portal 不存在」的纯 ADB 模式；它是 Python 设备层/说明，不是独立模型 Agent。[明确的模式表](https://github.com/droidrun/mobile-harness#local-android-modes) |
| pi / pi-ai | 提供模型接口、工具调用和 Agent 能力；ADB、截图、中文输入仍需自行接入，不能仅安装 pi 就控制手机。自定义模型必须声明 `input: ["text", "image"]`；当前文档说明非视觉模型可能忽略图像。[pi-ai 图像输入](https://github.com/earendil-works/pi/tree/main/packages/ai#image-input)、[自定义模型配置](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models-configuration.md) | 支持 provider、`baseUrl`、模型 ID、API Key。低层库支持浏览器；若采用本地 Node worker，则需要 Node。当前主线包为 `@earendil-works/pi-ai`，声明 Node `>=22.19.0`，不能照搬旧博客包名/API。[当前包](https://github.com/earendil-works/pi/blob/main/packages/ai/package.json)、[浏览器支持](https://github.com/earendil-works/pi/tree/main/packages/ai#browser-usage) | 可作为模型层替代；本次不同时引入 pi 和 AI SDK 两套模型层。 |
| AI SDK + Rust ADB | Rust 保留已安装 ADB，只开放截图、点击、滑动、返回、文本输入等窄工具；中文仍需要可用 IME，AI SDK 不解决设备输入。 | `ai` + 所需 Provider 包；OpenAI-compatible 可设置 `name / baseURL / apiKey` 和模型 ID，支持与实际模型相符的图像输入。[Provider 文档](https://ai-sdk.dev/providers/openai-compatible-providers)、[图像消息](https://ai-sdk.dev/docs/foundations/prompts#image-parts) | **备选后备**：本地 Node worker 负责模型循环，Tauri/Rust 执行设备工具，不需要 Python 或远程业务后台。比直接用 Open-AutoGLM 多写一层循环，但可接已有支持图像与工具调用的 Provider。 |

视觉模型直接看截图，可不配置独立 OCR 引擎；它仍是在识别图像及其中的文字，运行结果不应伪装成原生控件查询。截图保护或黑屏也会阻断视觉路线；Open-AutoGLM 源码对此返回黑色后备图，不提供绕过保证。[截图实现](https://github.com/zai-org/Open-AutoGLM/blob/main/phone_agent/adb/screenshot.py)

## 最小配置与验收边界

配置只需：执行模式（原生 / AutoGLM / 通用视觉）、Provider、Base URL、模型 ID、API Key 引用、最大步数与超时。API Key 放本机系统钥匙串，普通配置只保存引用；不放 GitHub 工作流、前端包或日志。本仓库已有 Rust `keyring` 依赖，沿用即可。界面应显示截图将发往哪个模型端点。

「OpenAI-compatible」只说明接口格式，不能证明模型支持图像或手机动作协议。AutoGLM runner 需要能遵循其 `do(action=...) / finish(...)` 协议的模型；通用 AI SDK Agent 则需要图像能力，并按其结构化工具契约输出。不能仅换 Base URL 就承诺任意模型可用。[AutoGLM 动作解析](https://github.com/zai-org/Open-AutoGLM/blob/main/phone_agent/actions/handler.py)、[AI SDK 能力说明](https://ai-sdk.dev/providers/openai-compatible-providers#supported-capabilities)

Python / Node 都可放到用户数据目录，首次选择相应模式时下载固定版本运行时及锁定依赖，校验完整性并缓存；这是部署建议，本次未实现。uv 官方支持缺少 Python 时自动下载 macOS/Windows/Linux 发行版；Node 官方提供独立二进制包；Tauri 支持外部可执行文件，但不会自动替项目解决运行时下载和版本管理。[uv](https://docs.astral.sh/uv/concepts/python-versions/)、[Node 下载](https://nodejs.org/en/download)、[Tauri 外部程序](https://v2.tauri.app/develop/sidecar/) 采用 API 模型时无需捆绑模型权重；也无需让普通原生流程加载这些运行时。

验收分三道：① Hamibot 需用户真正开启服务后，才能判定其节点兼容性；② 视觉路线需确认 ADB 截图可见、点击有效、输入法已获授权且中文可输入；③ 远端 Provider 需用户提供有效 API Key，并以真实图像请求验证端点、模型、计费权限和动作输出。本地自部署模型可不需商业 Key，但需要已运行的可用模型服务。以上都不能由静态文档或「配置已保存」代替。

本次群发测试只允许 `Ok`；文件传输助手示例按用户指定发送 `1`。模型不得自己改收件人或文本；发送后证据不足记为不确定并停止，不自动重试。现成框架的敏感操作确认不能替代此约束；Open-AutoGLM 的确认回调也依赖动作是否带相应标记。[动作处理源码](https://github.com/zai-org/Open-AutoGLM/blob/main/phone_agent/actions/handler.py)

未做手机、凭据或模型调用验证，未改业务代码。没有任何来源证明上述任一路线已完整兼容 vivo X21 / Android 9 / 微信 8.0.79；首选与备选均为待验收方案。
