# Android 自动化桌面客户端方案

调研日期：2026-10-15。本文对应最新需求：将现有微信昵称读取示例做成面向普通用户的桌面软件，提供安装包、环境检查与补齐、手机选择、执行过程和结果展示。

**可以实现。推荐以 Tauri 2 稳定版作为桌面壳，复用现有 Python + uiautomator2 执行逻辑，ADB 连接手机，scrcpy 按需提供投屏。客户不必安装 Python、Node.js、Rust、Android Studio 或 AutoJs6。首版先按 Windows 10/11 x64 交付。**

这是一份实现与验收方案，当前项目仍是命令行示例，尚未生成桌面程序或 EXE 安装包。界面框架尚未选择，本轮不创建新的前端工程。

## 1. Tauri 与 MyGo 的选择

| 对比项 | Tauri 2 | MyGo |
| --- | --- | --- |
| 实现方式 | Web 界面 + Rust 本地能力，使用系统 WebView | Go 本地能力；当前既有 WebView 界面，也有纯 Go native UI 路径 |
| Windows Web 界面 | 依赖 WebView2 | WebView 路径同样依赖 WebView2 |
| 安装与更新 | 官方支持 NSIS EXE / MSI、WebView2 安装策略、sidecar、更新插件 | 现有仓库已提供 NSIS 安装器、签名配置和 Ed25519 校验的更新机制，不能称作缺少这些功能 |
| 本次取舍 | **推荐用于客户交付**，现有稳定版本和分发文档更适合落实环境管理 | 可做验证候选；仓库较新，需额外验证 Windows 安装、升级及外部进程管理 |
| 项目最终体积 | 由界面资源、业务执行器、ADB、投屏和 WebView2 分发策略共同决定 | 同样取决于实际依赖；README 中的最小示例体积不能作为本项目包体承诺 |

MyGo 的 Go 方案是可行选项，推荐 Tauri 的依据是本次交付所需的成熟度，而不是认定 Go 不适合。具体仓库和源码证据见 [桌面框架调研笔记](../work/desktop-packaging-source-findings.md)。[1][2]

本次核查的 MyGo 为 v0.5.1，可见最早 GitHub Release 在 2026-09-27；这只是公开记录的时间跨度，不代表实际开发时长。其当前 NSIS 模板尚未确认自动补装 WebView2，选择 WebView 路径时需单独补齐这部分；纯 Go native UI 可以避开 WebView2，但仍要验证目标界面体验。

## 2. 用户实际操作

1. **安装软件。** 下载 `Setup.exe`，安装器检查 WebView2；缺失时下载安装。这里不要求用户先打开终端。
2. **初始化环境。** 首次打开显示检查清单，点击“安装缺少的组件”，软件下载固定版本的 ADB 和自动化执行器，显示进度，完成后自动重新检查。
3. **连接手机。** 设备页显示“未连接 / 等待手机授权 / 离线 / 可使用”。对未授权状态展示手机端操作指引，授权后刷新设备状态。
4. **执行示例。** 选中手机，点击“读取微信昵称”。界面显示“连接手机 → 启动微信 → 打开个人信息 → 读取完成”。
5. **查看结果。** 软件内展示设备、昵称、执行时间、完成截图；失败时显示具体步骤和原因。点击“打开投屏”可查看手机实时画面。

首版保持三个页面：**环境与连接、设备操作、运行结果**。实时投屏先打开独立 scrcpy 窗口；软件内显示执行状态和截图。内嵌完整视频流不是当前示例的必要部分。

## 3. 环境预检与自动补齐

WebView2 的预检由安装器负责，因为缺少它时 Web 界面无法启动。其他项目在软件内检查和修复。[3]

| 检查项目 | 检查与处理方式 | 用户需要做的事 |
| --- | --- | --- |
| 系统版本 / 架构 | 识别 Windows 和 CPU 架构，拒绝安装不匹配的构建 | 首版使用约定的 Windows x64 环境 |
| WebView2 | 安装器检测，缺失时运行官方安装程序 | 如系统提示，确认安装 |
| ADB | 检查应用管理目录内的二进制和版本，缺失时下载并验证 | 点击一次“安装组件” |
| 自动化执行器 | 安装包含 Python 解释器、所需库及 uiautomator2 资源的冻结分发包，运行自检 | 无须自行安装 Python 或运行 pip |
| scrcpy | 首次打开投屏时安装匹配系统的发行包 | 点击“打开投屏” |
| Windows USB 驱动 | 结合设备信息提示相应厂商的官方驱动；有已验证安装流程的型号可代为启动安装器 | 部分型号需要管理员确认；不能承诺所有品牌均静默安装 |
| 手机与 ADB 状态 | 区分 `device`、`unauthorized`、`offline` 和空列表，提供对应处理指引 | 连接数据线、开启 USB 调试、允许电脑调试 |
| 微信与手机状态 | 检查安装包、前台启动、页面可识别程度和自动化服务连通性 | 解锁、登录微信，必要时关闭弹窗或返回主界面 |

ADB 列表为空只能说明当前未发现可用连接，不能直接断定缺驱动，也可能是数据线、USB 模式或手机设置造成。Android 官方明确要求手机开启 USB 调试并确认电脑的 RSA 授权；Windows 的 USB 驱动依厂商而异。[4][5]

uiautomator2 3.7.0 会准备手机端的 `u2.jar` 并启动服务；相关资源要随执行器打包。昵称读取不需要再部署 AutoJs6，也不应为了当前只读示例额外开启输入法等无关能力。[6]

组件安装到应用管理的用户数据目录，使用固定版本及明确的文件校验信息；下载进度和失败重试显示在界面中。第一版由受控 HTTPS 下载源提供这些文件，不让客户安装时临时从 PyPI 拉取可变化的依赖。国内分发应验证实际下载连通性，发布时保留依赖许可证及必要通知。

应用安装包更新与环境组件版本清单分别管理；下载完成且校验通过后再启用新组件，保留可用版本供失败恢复。框架 updater 不会自动完成这些环境管理功能。

## 4. 小安装包的策略

**推荐“在线安装包 + 首次按需下载 + 本地缓存”。** 把安装包下载量、首次初始化下载量、最终磁盘占用分别展示和验收。

| 分发方式 | 用户体验 | 体积与取舍 |
| --- | --- | --- |
| 在线安装包，推荐 | 安装桌面壳，首次使用时自动补齐工具，以后复用缓存 | 主安装包较小；首次使用需要联网 |
| 完整离线包 | 预装所有必要组件，可在无网络环境部署 | 包含自动化运行时、ADB、投屏及所选 WebView2 安装资源，明显更大 |

Tauri 官方文档给出了 WebView2 的 `downloadBootstrapper`、`embedBootstrapper`、`offlineInstaller`、`fixedRuntime` 等分发模式。`skip` 不负责安装运行时，不适合作为面向未知客户电脑的默认策略；固定捆绑运行时也不符合本项目优先减小主包的目标。[3]

量级参考：本次查询的 scrcpy 官方 `v5.0.1` Windows x64 ZIP 为 **11,264,634 bytes，约 10.74 MiB**。它只是一个组件，不能把框架最小示例的“几 MB”当成最终完整交付体积。[7]

若要先设预算，可将主安装包按 **20 MB 以内的目标** 设计，但这不是已经测得的结果或交付承诺。Python 执行器及其他组件的下载量要在实际 Windows 构建后统计；缺少 WebView2 时还需计入微软运行时下载。重新联网不会重复下载已完整且校验通过的同版本组件。

Python 用 PyInstaller 等工具构建成包含解释器与依赖的私有执行器，而不是要求客户安装系统 Python。建议先用 one-folder 形式压缩分发，避免运行时每次解包和资源定位复杂化；PyInstaller 官方说明其冻结包包含运行所需解释器及模块。[8]

## 5. 现有代码怎样接入

```text
桌面界面：环境检查 / 手机列表 / 读取昵称 / 运行结果
                         |
                 Tauri Rust 本地命令
                 /                 \
     组件安装与设备发现          按设备启动 Python 执行器
             |                         |
       ADB / scrcpy              uiautomator2 -> ADB -> 微信
                                       |
                           步骤事件 + 昵称 + 截图 + 错误
```

保留 `wechat_demo.py` 中已实现的 `choose_device`、`find_me_tab`、`parse_nickname` 和微信页面操作；保留现有命令行入口及解析测试。为桌面交付补齐以下边界即可：

1. **组件路径。** 从应用管理目录解析 ADB、scrcpy 和执行器绝对路径，给子进程设置自己的运行环境；不依赖客户 PATH，也不修改整个系统 PATH。在线下载的执行器由 Rust 按受控路径启动；离线内置执行器可使用 Tauri 的 external binary 分发机制。[9]
2. **结果路径。** 将当前脚本目录下的 `runs/` 改为用户可写的数据目录，例如 `%LOCALAPPDATA%\PorAuto\runs\`。不能假定安装目录或冻结后的 `__file__` 目录可用于长期保存结果。[10]
3. **结构化过程。** 执行器输出约定的 JSON Lines 事件，包含设备、步骤、状态和结果；诊断日志走独立通道。界面不靠截取中文终端提示判断成功，必须核对有效的结束事件和结果数据。
4. **Windows 运行与资源。** 构建时包含 uiautomator2 资源和 Windows 所需时区数据。当前 `ZoneInfo("Asia/Shanghai")` 在缺少 IANA 数据的 Windows 上可能失败，须随执行器加入 `tzdata` 并验证资源收集。[6][11]
5. **进程和设备占用。** 任务在子进程执行，保持界面可操作；同一设备一次只跑一个自动化任务。断连、超时和退出都产生明确状态。投屏与任务进程分别管理，不能用结束所有系统 ADB 进程作为普通“修复”按钮。

前端只调用“列设备、安装指定组件、读取昵称、打开投屏”等有限命令，不暴露任意 shell 执行入口。界面无需配套 Hono 服务、云后台或账号系统。界面技术选定后再建工程，不为这个本地示例引入独立 Web 服务。

## 6. 首版验收与实施顺序

首版固定范围：**一台 Windows 电脑、一台 Android 手机、环境检查与补齐、投屏、读取昵称、过程和结果展示。** 设备列表预留按序列号选择，但多设备调度、定时转发及群管理属于后续需求。

1. **先完成真机验证。** 用现有脚本读取实际客户微信昵称，确认节点与结果一致。当前电脑没有 ADB 设备，之前未完成此项。
2. **制作 Windows 执行器。** 在 Windows 构建与验证解释器、uiautomator2 资源、时区、中文路径和用户数据写入；保留现有解析测试。
3. **完成最小桌面闭环。** 环境页下载组件，设备页按序列号执行，结果页显示昵称和截图。完成后测量主包、首次下载和磁盘占用。
4. **在干净 Windows 环境验收。** 不预装 Python/Node.js/ADB，覆盖有与无 WebView2、下载中断重试、未授权、断连、缺微信和解析失败。发布包由 Windows 构建环境或 Windows CI 产出，并安排代码签名。

验收成功的证据是用户从图形界面完成初始化和操作，且软件内昵称、结果文件、手机个人信息页三者一致。不能用开发机上已经安装好的环境或构造 XML 测试代替安装与真机验证。

## 7. 第一手来源

1. [Tauri 官方仓库](https://github.com/tauri-apps/tauri)、[官方发布记录](https://github.com/tauri-apps/tauri/releases)。
2. [MyGo 官方仓库](https://github.com/egoist/mygo)、[官方发布记录](https://github.com/egoist/mygo/releases)。具体版本和功能源码见配套调研笔记。
3. [Tauri：Windows Installer 与 WebView2 安装模式](https://v2.tauri.app/distribute/windows-installer/)。
4. [Android：ADB 与 USB 调试授权](https://developer.android.com/tools/adb)。
5. [Android：安装 OEM USB 驱动](https://developer.android.com/studio/run/oem-usb)。
6. [uiautomator2 3.7.0：准备并启动设备端服务](https://github.com/openatx/uiautomator2/blob/3.7.0/uiautomator2/core.py)、[输入法组件按输入能力安装](https://github.com/openatx/uiautomator2/blob/3.7.0/uiautomator2/_input.py)。
7. [scrcpy v5.0.1 发布页](https://github.com/Genymobile/scrcpy/releases/tag/v5.0.1)、[GitHub 官方 Release API 的文件大小](https://api.github.com/repos/Genymobile/scrcpy/releases/tags/v5.0.1)。
8. [PyInstaller：打包原理及 one-folder / one-file](https://pyinstaller.org/en/stable/operating-mode.html)。
9. [Tauri：Embedding External Binaries](https://v2.tauri.app/develop/sidecar/)。
10. [PyInstaller：冻结后的路径与运行时信息](https://pyinstaller.org/en/stable/runtime-information.html)。
11. [Python：zoneinfo 的 Windows 数据依赖](https://docs.python.org/3/library/zoneinfo.html#data-sources)。

本轮核查了官方文档、部分源码和现有 Python 环境中的依赖资源；未构建 Windows 安装包、未测量本项目最终包体、未连接真实手机。Context7 查询遇到配额限制，研究使用第一方站点、仓库及官方 API 继续完成。
