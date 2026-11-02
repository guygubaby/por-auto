# Android 自动化桌面安装包：Tauri / MyGo 一手资料核查

采集日期：2026-10-15（Asia/Shanghai）。本次仅研究桌面外壳、Windows 安装、运行时和更新，不搭建前端、不修改现有自动化脚本，也没有测量本项目的 Windows 安装包。

## 结论

本项目可用 **Tauri 2 + 现有自动化执行器** 做 Windows 图形软件，由安装器处理 WebView2，应用内处理 ADB、执行器、手机连接状态与结果展示。Tauri 的 sidecar 文档明确以 PyInstaller 打包 Python CLI 为示例，适合保留已写好的 Python / uiautomator2 逻辑。[Tauri sidecar 官方文档](https://v2.tauri.app/develop/sidecar/)

**MyGo 也是可行候选，已经有安装和更新能力，不能称它“缺这些功能”。** 但目前公开 Release 历史较短；若本项目优先考虑客户交付，建议选择 Tauri 2，把 MyGo 留给独立打包验证。这个选择是工程判断，不是对 MyGo 功能不存在的判断。

小体积与完整离线依赖包要分开衡量。下载型安装器可以小，但首次使用仍可能下载 WebView2、Python 执行器、ADB、投屏工具等；不能把框架 README 的几 MB 宣传数字当成整个 Android 自动化产品的安装包体积。

## 版本与资料固定点

| 项目 | 本次核查版本 | 可复现固定点 |
|---|---|---|
| MyGo | v0.5.1 | [Tag](https://github.com/egoist/mygo/tree/v0.5.1)，commit `408b4def1f3e6a8d3fac852396b4a46d82ba22a3` |
| Tauri | 2.12.4 | [Tag](https://github.com/tauri-apps/tauri/tree/tauri-v2.12.4)，commit `59b63ab500da9859f12d8888c3298bc29bba0b92` |
| Tauri v2 文档 | 采集时 v2 分支 | commit [`32f68c5bfe8b7c42ea5b4d312b533d26521b626c`](https://github.com/tauri-apps/tauri-docs/commit/32f68c5bfe8b7c42ea5b4d312b533d26521b626c) |

采集时 Tauri 仓库同时出现 `tauri-v3.0.0-alpha.5`；它是 alpha，不因为 GitHub Release 的 `prerelease` 元数据为 false 就当作稳定版。此方案按 v2 稳定系列讨论。[Release 列表](https://github.com/tauri-apps/tauri/releases)

## MyGo：已确认的能力与边界

### 技术栈与 Windows 要求

- MyGo 有两种 UI：HTML/CSS/JS 前端 + Go 后端；或 `ui` 包的纯 Go native UI。Web 前端在 Windows 使用 WebView2，在 macOS 使用 WKWebView，在 Linux 使用 WebKitGTK。Go 方法可生成 TypeScript 客户端，用于类型化 IPC。[固定版 README](https://github.com/egoist/mygo/blob/v0.5.1/README.md)、[文档总览](https://github.com/egoist/mygo/blob/v0.5.1/docs/README.md)
- v0.5.1 文档声明支持 Windows 10 / 11、x64 / arm64。Web 前端需要 WebView2 Runtime；纯 Go native UI 使用 Direct3D 11，不需要 WebView2。开发机需要 Go 1.27+；`go.mod` 具体声明 `go 1.27.1`。Bun/前端工具只属于开发构建环节，交付的 Go 程序不要求客户先装 Go 或 Bun。[Requirements](https://github.com/egoist/mygo/blob/v0.5.1/docs/README.md#requirements)、[go.mod](https://github.com/egoist/mygo/blob/v0.5.1/go.mod)
- 文档提供 `mygo.WebViewAvailable()` 供运行前检测 WebView 是否可用；缺 WebView 时可以选择 native UI 作为提示/引导窗口。`mygo doctor` 定位是**开发机**环境检查，并不等于本产品的手机/ADB/执行器 preflight。[Requirements](https://github.com/egoist/mygo/blob/v0.5.1/docs/README.md#requirements)、[doctor.go](https://github.com/egoist/mygo/blob/v0.5.1/cmd/mygo/doctor.go)

### 安装器、外部工具与更新

- `mygo build` 能输出 Windows 程序和 NSIS `Setup ... .exe`；默认按当前用户安装到 `%LOCALAPPDATA%\Programs\My App`，含开始菜单、可选桌面快捷方式和卸载器，无须因为安装应用本身而获取管理员权限。[distribution.md Windows 章节](https://github.com/egoist/mygo/blob/v0.5.1/docs/distribution.md#windows)、[nsis.go](https://github.com/egoist/mygo/blob/v0.5.1/cmd/mygo/nsis.go#L269)
- Windows **开发构建机**没有 NSIS 时，MyGo CLI 能下载固定版本 NSIS 并校验 SHA-256。这个能力是为构建安装包补齐工具，不能描述成“用户手机环境自动补齐”。macOS/Linux 构建 Windows 安装器仍需要当地装有 NSIS。[nsis.go](https://github.com/egoist/mygo/blob/v0.5.1/cmd/mygo/nsis.go#L21)、[distribution.md](https://github.com/egoist/mygo/blob/v0.5.1/docs/distribution.md)
- 外部执行器可以放在按系统/架构区分的 `resources` 下，由 Go `exec.Command` 调用。MyGo 有资源打包规则与辅助程序签名流程，不会强迫把 Python 自动化全部重写成 Go。[Helper executables](https://github.com/egoist/mygo/blob/v0.5.1/docs/distribution.md#helper-executables)、[build.go](https://github.com/egoist/mygo/blob/v0.5.1/cmd/mygo/build.go)
- Windows 支持证书或自定义命令签名主程序、安装器和辅助 EXE/DLL；官方示例用 Windows SDK 的 `signtool` 或其他系统上的 `osslsigncode`。签名是否最终消除 SmartScreen 提示不能据此保证，仍需验证实际证书与安装包信誉。[winsign.go](https://github.com/egoist/mygo/blob/v0.5.1/cmd/mygo/winsign.go)、[Code signing](https://github.com/egoist/mygo/blob/v0.5.1/docs/distribution.md#code-signing)
- 已有自动更新：发布到 GitHub、HTTPS 服务或 S3 兼容存储；更新包签名，客户端校验后替换；有差分更新与失败回退全量包、进度回调、可选更新 UI。源码使用 Ed25519 公钥校验，限定 HTTPS（测试允许 loopback HTTP），检查下载长度与签名。自动更新要求应用可写安装目录。[updates.md](https://github.com/egoist/mygo/blob/v0.5.1/docs/updates.md)、[updater.go](https://github.com/egoist/mygo/blob/v0.5.1/updater.go)、[internal/update](https://github.com/egoist/mygo/tree/v0.5.1/internal/update)
- 本次检查的 v0.5.1 `nsis.go` 模板中未看到 Tauri `webviewInstallMode` 那样的 WebView2 下载/安装配置。可确认其有 WebView 可用性检测；**不能据此承诺其安装器已经替本项目自动补齐 WebView2**。若选 MyGo Web 前端，需要补查或实现缺失运行时的 bootstrap 流程。[nsis.go](https://github.com/egoist/mygo/blob/v0.5.1/cmd/mygo/nsis.go#L322)、[webview2.go](https://github.com/egoist/mygo/blob/v0.5.1/internal/windows/webview2.go)

### 公开成熟度与许可

GitHub API 于采集日返回：仓库 `created_at = 2026-09-26T15:21:37Z`，约 1,974 stars；当前仍可查询到的最早 GitHub Release 是 v0.1.1，`published_at = 2026-09-27T07:27:00Z`；最新版本 v0.5.1 发布于 `2026-10-14T23:02:36Z`。这说明**当前可见的公开仓库/Release 时间跨度短**，不能证明作者实际只开发了这些天，也不能排除更早未发布版本或迁移历史。[仓库 API](https://api.github.com/repos/egoist/mygo)、[Release API](https://api.github.com/repos/egoist/mygo/releases?per_page=100)、[v0.1.1](https://github.com/egoist/mygo/releases/tag/v0.1.1)、[v0.5.1](https://github.com/egoist/mygo/releases/tag/v0.5.1)

v0.5.1 的 GitHub Release 没有二进制附件；不能据此断言 CLI 不可用，其发布工作流会发布 npm 包并登记 Go module。[release.yml](https://github.com/egoist/mygo/blob/v0.5.1/.github/workflows/release.yml)

项目已经有 Windows、macOS、Linux CI，含单测与 GUI 测试；另有 Windows ARM64 job。这里只核查了工作流源码，没有审计所有运行记录或独立重跑测试，不能把“写了 CI”说成“我们的环境已验证通过”。[ci.yml](https://github.com/egoist/mygo/blob/v0.5.1/.github/workflows/ci.yml)

许可为 MIT。具体捆绑 ADB、Python、投屏组件后，还要分别保留这些第三方组件的许可证与通告；MyGo 的 MIT 不能代替整包依赖的许可。[LICENSE](https://github.com/egoist/mygo/blob/v0.5.1/LICENSE)

## Tauri 2：与此项目直接相关的能力

### Windows 安装器与 WebView2

Tauri 支持 WiX `.msi` 与 NSIS `-setup.exe`。`.msi` 必须在 Windows 生成；官方把 macOS/Linux 交叉构建 Windows NSIS 包描述为有 caveat 且测试较少，建议优先 Windows 本机/VM/CI。[Windows Installer 官方文档](https://v2.tauri.app/distribute/windows-installer/)、[固定文档源码](https://github.com/tauri-apps/tauri-docs/blob/32f68c5bfe8b7c42ea5b4d312b533d26521b626c/src/content/docs/distribute/windows-installer.mdx)

| 配置 | 没有 WebView2 时的行为 | 本项目判断 |
|---|---|---|
| `downloadBootstrapper`（默认） | 安装时下载 bootstrapper，再安装 Runtime；需要联网 | 适合小型在线安装包 |
| `embedBootstrapper` | 随包附带小型 bootstrapper，仍需联网下载 Runtime | 适合减掉一段 bootstrapper 下载链路；不等于离线包 |
| `offlineInstaller` | 随包附带完整 Runtime 安装器 | 可用于离线环境，安装包显著增大 |
| `fixedRuntime` | 随包携带固定版本 Runtime 文件 | 安装包显著增大，还要自行维护 Runtime 更新 |
| `skip` | 不检测/补装 Runtime | 不符合本项目面向普通用户的完整安装体验 |

来源：[Tauri WebView2 Installation Options](https://v2.tauri.app/distribute/windows-installer/#webview2-installation-options)。官方文档中的约 1.8 MB / 127 MB / 180 MB 是不同 WebView2 部署方式的参考额外开销，随版本变化；**不是此项目实际包体实测值**，也不应据此承诺交付时数字。

WebView2 缺失时，基于 WebView2 的主界面尚未必能启动，因此应在**安装器/原生 bootstrap 阶段**补齐它；不能只在 WebView2 主界面中提供“安装 WebView2”按钮。Microsoft 明确建议在安装/更新期间检测，创建 WebView 前补装。Windows 11 随系统提供 Runtime、绝大多数 Windows 10 已有，但小部分设备仍缺失；有 Edge 浏览器也不能替代检测 Runtime。[Microsoft 官方 Distribution 文档](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)

### Sidecar、进度与更新

- `bundle.externalBin` 用于打包外部可执行文件；官方举例包括 PyInstaller 打包的 Python CLI。需要为各平台/架构提供对应可执行文件，不是 Tauri 自动把 Python 解释器编进 Rust。[Embedding External Binaries](https://v2.tauri.app/develop/sidecar/)
- shell plugin 能启动 sidecar、读 stdout/stderr、写 stdin；Rust 可以把进度发给前端事件。因此可复用现有 Python 执行器，通过结构化输出驱动“当前步骤、设备、结果、错误”界面；不必为这个本地工具额外搭建公网 API。[Sidecar 文档中的 Rust 示例](https://v2.tauri.app/develop/sidecar/#running-it-from-rust)
- 前端调用外部程序需要 capability/permission，且可约束参数。具体的运行时下载、版本清单和 ADB 检测属于本产品实现，不是装了 Tauri 就自带。[Sidecar permissions](https://v2.tauri.app/develop/sidecar/#running-it-from-javascript)
- updater 官方插件支持静态 JSON 或更新服务，更新签名校验不可关闭。应用自动更新与“下载/修复 ADB、执行器等环境组件”应分别建模；后一项不能以 updater 已存在为由宣称自动实现。[Updater 官方文档](https://v2.tauri.app/plugin/updater/)

### 公开历史与许可

Tauri 2.0.0 发布于 `2024-10-02T13:23:35Z`；2.12.4 发布于 `2026-10-14T18:52:14Z`。相比本次可见的 MyGo Release 记录，Tauri 稳定大版本的公开维护历史更长。[2.0.0 Release](https://github.com/tauri-apps/tauri/releases/tag/tauri-v2.0.0)、[2.12.4 Release](https://github.com/tauri-apps/tauri/releases/tag/tauri-v2.12.4)

Tauri workspace 声明 `Apache-2.0 OR MIT`，可按对应许可证遵守其义务。仍应单独处理捆绑工具的许可。[固定版 Cargo.toml](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.4/Cargo.toml)

## 尚未核实 / 交付前需要实测

1. 没有在干净的 Windows 10/11 x64 电脑实际安装这两个框架的本项目包；安装包体、安装后占用、冷启动、SmartScreen 行为都未测量。
2. 没有在本项目上验证 MyGo 的 NSIS 安装器、自动更新/差分更新、WebView2 缺失恢复；已确认的是文档与对应源码存在。
3. 没有验证 MyGo 原生 UI 在目标 Windows 中文输入、文本显示、截图预览和长日志列表上的表现；它可减少 WebView2 依赖，但不是当前 Web UI 的无成本替换。
4. 两种框架均不自动消除手机端 USB 调试授权、手机解锁、微信登录、OEM 驱动等外部条件；桌面框架选择不能代替连接与真实手机自动化验证。

资料检索说明：尝试通过 Context7 查询，但服务返回月度配额耗尽；随后直接读取官方文档、GitHub API 和固定 Tag 源码。未使用二手博客或宣传文章作为上述结论的依据。
