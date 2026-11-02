# Kero 核心实现调查

调查日期：2026-10-21。依据 GitHub 当时的 HEAD [`8f4543205744996cdc52b620437ad6b828623d15`](https://github.com/egoist/kero/commit/8f4543205744996cdc52b620437ad6b828623d15)，仅静态阅读项目自己的源码；未运行项目、安装依赖或验证运行时行为。

## 用户关注点：MyGo 桌面框架与 Por Auto 迁移

Kero 的桌面界面确实使用 **Go + MyGo 的原生 UI 模式**。`main.go` 用 `mygo.NewWindow` 创建窗口，并把 `ui.View(a.view)` 作为内容；`view.go`、`panes.go` 用 Go 的布局与控件 API 绘制侧栏、卡片和分屏。Kero 依赖 MyGo v0.6.0；根目录的 Bun workspace 面向官网与文档。[main.go](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/main.go)、[view.go](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/view.go)、[go.mod](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/go.mod)、[package.json](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/package.json)

MyGo 官方提供两种可混用的模式：用 Go 写界面并由 GPU 自绘，或在系统 WebView 中加载 Web 前端并生成 TypeScript → Go 的类型化调用接口。后者使用 WKWebView / WebKitGTK / WebView2。这些是框架声明的能力，本轮未独立运行验证。[MyGo v0.6.0 README](https://github.com/egoist/mygo/blob/v0.6.0/README.md)

当前 Por Auto 是 Vue 3 / Tailwind CSS / Tauri 2 / Rust：`src/` 中有 28 个 Vue 文件，Rust 入口注册 29 个 `#[tauri::command]`。19 个 Rust 源文件约 11,540 行，直接引入 Tauri 的主要文件是 `main.rs`、`updater.rs` 和 `mobile_assets.rs`；核心模块仍有共享类型等间接依赖，不能未经整理直接作为独立服务运行。[package.json](/Users/bryceloskie/i/por/por-auto/package.json)、[main.rs](/Users/bryceloskie/i/por/por-auto/src-tauri/src/main.rs)、[updater.rs](/Users/bryceloskie/i/por/por-auto/src-tauri/src/updater.rs)、[mobile_assets.rs](/Users/bryceloskie/i/por/por-auto/src-tauri/src/mobile_assets.rs)

迁移在架构上可行，以下是方案判断，并非已经实现：

| 路线 | Vue 界面 | Rust 业务核心 | 主要改动 |
| --- | --- | --- | --- |
| MyGo WebView 模式 | 大部分可保留 | 可整理为本地执行进程保留 | Go 宿主、29 个调用接口、事件、资源路径、更新和打包 |
| MyGo 原生 UI 模式 | 用 Go UI 重写 | 同样可以保留 | 上述宿主改动，加布局、组件、表单、状态与交互重建 |

若目标是 Kero 采用的原生 UI，建议先做 **MyGo 原生界面 → Go 调用层 → Rust 本地执行进程 → ADB / 手机** 的小型原型。Go 与 Rust 可以用进程管道传递 JSON 请求和进度事件，无需新增对外监听的 HTTP 服务。优先复用已验证的设备控制、工作流、HTTP、定时与草稿保护逻辑；手机端 Kotlin 输入组件和 AutoJs6 工作流可保留原协议。现有 Tauri API 不能直接作为 MyGo API 使用，文件保存、更新、凭据与数据目录兼容需要单独接入。

最小验证范围是设备列表、启动一次预演、进度回传和取消；之后再验证 Windows、中文输入与编辑控件、文件对话框、数据目录及系统凭据迁移、更新签名。MyGo 宣称的低内存和启动优势尚未在 Por Auto 上测量，不据此承诺迁移后的资源占用或安装包大小。当前应用源码与技术栈均未迁移。

## 结论

Kero 是面向 coding agent 的终端与会话管理器。其控制对象是自己启动、由 `kerod` 持有的终端 pane；关键路径是 **PTY → 终端模拟器 → 文本规则/主动状态上报 → Unix socket RPC/终端帧 → 桌面 UI 与 CLI**。从已追踪的核心路径看，它没有借助系统无障碍树、截图 OCR、VLM 或 ADB 来操作其他应用。[daemon.go 1–4](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/daemon/daemon.go#L1-L4)、[session.go 26–28](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/daemon/session.go#L26-L28)、[RPC send/read](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/daemon/rpc.go#L174-L195)

## 1. 执行程序：真实 PTY，不是模拟敲击系统键盘

每个 pane 选择用户 shell、工作目录、环境变量，交给 `startPTY`；输出经 `pump` 持续读取并喂给终端模拟器。macOS/Linux 自己打开 PTY，把 shell 的 stdin/stdout/stderr 都接到 slave，设置 `Setsid`/`Setctty`；Windows 则调用 `CreatePseudoConsole`，即 ConPTY。[pane 启动与输出](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/daemon/session.go#L130-L199)、[Unix PTY](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/daemon/pty_unix.go#L31-L68)、[Windows ConPTY](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/daemon/pty_windows.go#L17-L94)

`kerod` 独立持有进程和终端，所以关闭 UI 只是断开连接，终端会话仍可继续运行。这一点更接近带原生 UI 的终端复用器。[daemon.go 1–4](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/daemon/daemon.go#L1-L4)

## 2. 观察画面：读取终端模拟器的文本

daemon 使用 MyGo 的 terminal 插件，其注释明确指出 headless `libghostty-vt` 保存 screen 与 scrollback；输出调用 `s.term.Feed(p)`。`screen()` 直接从 `s.term.Text()` 取最后一个屏幕的文本；`readText()` 可以按需包含 scrollback/限制行数。CLI 的 `capture` 实际上是 `read` 的别名，输出文本。[模拟器初始化](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/daemon/session.go#L26-L28)、[Feed](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/daemon/session.go#L181-L194)、[screen](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/daemon/session.go#L406-L411)、[readText](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/daemon/session.go#L690-L706)、[capture/read](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/cli/cli.go#L398-L412)

UI 连接 daemon 后以 terminal mirror 帧显示同一终端的内容，而不是另行运行 shell 或截取桌面。这里的 frame 是终端协议帧，终端本身也可能包含图片数据；不要把“frame”理解成供视觉模型识别的桌面截图。[app.go 522–558](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/app.go#L522-L558)、[frame.go 9–24](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/proto/frame.go#L9-L24)、[图片 payload 注释](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/proto/frame.go#L68-L74)

## 3. Agent 状态：进程识别 + TOML 文本规则 + OSC 协议

先读取 PTY 前台进程组，再根据可执行文件/脚本名和参数判断是 Claude、Codex、Gemini 等哪个 agent。macOS 的进程信息来自 `sysctl` 与 `proc_pidinfo`。[session.go 279–344](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/daemon/session.go#L279-L344)、[agent 名称识别](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/daemon/daemon.go#L391-L429)、[macOS 进程查询](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/daemon/proc_darwin.go#L13-L88)

识别出 agent 后，`detect` 用对应的内嵌 TOML manifest，匹配终端标题、底部若干行、prompt 区域等文本；规则支持 contains、regex、line_regex、all/any/not，最高优先级胜出，无匹配默认 idle。例如 Claude 的标题 spinner、`esc to interrupt`、权限提示都有专门规则。项目注明这些规则移植自 herdr。[规则来源与输入](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/detect/detect.go#L1-L9)、[检测流程](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/detect/detect.go#L148-L178)、[匹配器](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/detect/detect.go#L221-L259)、[Claude 规则例子](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/detect/manifests/claude.toml#L7-L25)

程序也能用 `kero report` 输出 OSC 7501，主动声明 working/blocked/done/error 和进度；daemon 解析它，并兼容 OSC 9;4 进度、OSC 133 shell 标记。主动 working/blocked 会优先于文本猜测。[CLI report](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/cli/cli.go#L823-L858)、[OSC 解析](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/daemon/osc.go#L214-L270)、[优先级与声明](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/daemon/osc.go#L347-L440)

实现上的边界：这些状态代表“程序主动报告或终端文字看起来如此”，不能证明业务结果正确；agent 的 TUI 文案/布局改变可能需要更新 manifest。无规则的普通程序主要看终端标题忙碌标记，不能理解任意 GUI。此为上述实现的推论。[状态读取主流程](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/daemon/session.go#L347-L403)

## 4. 文本和按键：写入 PTY 字节

RPC `send` 调用 `pn.input([]byte(p.Data))`，最终 `proc.Write(p)` 写入 PTY master/ConPTY 输入管道。`kero key` 把 Enter、方向键、Ctrl/Alt 组合等转成控制字节/转义序列；它不是操作系统级按键注入。[RPC send](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/daemon/rpc.go#L174-L184)、[input](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/daemon/session.go#L414-L435)、[Unix Write](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/daemon/pty_unix.go#L71-L83)、[key 编码](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/cli/cli.go#L767-L799)

`kero prompt` 封装了一次自动交互：发送文本 → 等 120ms 后单独发送回车 → wait 状态变化 → read 当前文本。这让一个 agent 通过 CLI 驱动另一个 agent 所在 pane，推理由外部 Claude/Codex 等完成。[cli.go 325–377](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/cli/cli.go#L325-L377)

## 5. Remote Control 与 agent 集成边界

daemon 在权限为 `0600` 的 Unix socket 上接受连接。控制连接是逐行 JSON（id/method/params/result/event）；终端 attach 连接用“类型字节 + uint32 长度 + payload”。两者复用 daemon。[socket](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/daemon/daemon.go#L88-L95)、[握手与 attach](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/daemon/daemon.go#L469-L539)、[控制 RPC](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/daemon/daemon.go#L543-L582)

`kero do` 触发 Kero 自己已有的动作，例如分屏、切换会话、显示侧栏、字体缩放。CLI 和 UI 检查动作的 `Remote` 标记，UI 的 `RemoteControl` 设置决定是否执行。它并不提供通用的其他 App 控件树、点击坐标或设备操作接口。[动作表](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/actions/actions.go#L11-L58)、[CLI do](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/cli/cli.go#L523-L546)、[UI 接收](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/app.go#L230-L255)、[动作执行](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/actions.go#L17-L85)

SessionStart hook 把当前 session/pane 和 CLI 使用提示传给 agent，同时登记 agent 自己的会话 ID 以便恢复；它不是另一个内置模型或决策引擎。[hook.go 22–74](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/cli/hook.go#L22-L74)、[注入上下文](https://github.com/egoist/kero/blob/8f4543205744996cdc52b620437ad6b828623d15/internal/cli/hook.go#L123-L157)
