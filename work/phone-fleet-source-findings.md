# 一台电脑管理多台 Android 真机：开源群控工具核查

核查日期：2026-10-15，Asia/Shanghai。只使用 GitHub 元数据、Release、README、官方仓库文档和源码；未运行软件、未连接手机、未发送消息。星数是本次快照；日期按 GitHub 的 UTC 日期列示。`pushed_at` 与默认分支最新提交日期分别理解。

## 可直接采用的结论

1. **需要现成开源的人工投屏和同步操作，优先 QtScrcpy。** 开源源码直接实现对所选从设备广播鼠标、键盘、文本、粘贴、截图等，不只是 README 写了“群控”。Windows 和 Linux 有成品发行包。[Q1][Q2][Q3]
2. **Escrcpy 适合设备列表、批量投屏、截图、安装、文件推送及预置 ADB 命令辅助。** README 宣传单窗广播、可视化自动化和批执行，但同时说明部分高级特性来自收费私有仓库 EscrcpyX；本轮公开代码能确认基础批量功能，不能确认所有宣传项都在开源版中。[E1][E2][E3][E4]
3. **STF 更适合浏览器设备实验室、多人预约和远程设备分配。** Linux 服务端/设备 Provider + 浏览器的部署形态，复杂度高于前两款桌面工具。本次证据没有证明它是开箱即用的同步群控或微信脚本平台。[S1][S2][S3]

三者都不能仅凭“群控”推导出源微信群识别、各手机独立群列表、定时转发、消息去重或发送回读。该业务仍适合由 ADB + 每设备自动化 worker 完成，投屏工具用于人工检查和接管；这属于本需求的架构建议，不是这些项目宣称已具备的微信功能。

## 1. 维护与发行快照

| 项目 | Stars / 归档 | 最新 GitHub Release | 默认分支最新提交 | 许可 |
| --- | --- | --- | --- | --- |
| [viarotel-org/escrcpy](https://github.com/viarotel-org/escrcpy) | 12,070；未归档 | v3.3.1，2026-10-10 | main：2026-10-10，`e35972b`，提交说明为发布 v3.3.1 基础源码 | Apache-2.0。[E1][E2] |
| [barry-ran/QtScrcpy](https://github.com/barry-ran/QtScrcpy) | 32,406；未归档 | v4.2.1，2026-09-19 | dev：2026-09-24，`f90e225` | Apache-2.0。[Q1][Q2] |
| [DeviceFarmer/stf](https://github.com/DeviceFarmer/stf) | 4,599；未归档 | v3.8.0，2026-09-23 | master：2026-10-02，`be79c0c` | LICENSE 正文是 Apache-2.0；GitHub API 自动分类为 Other/NOASSERTION，应以文件正文说明。[S1][S4] |

不将更新 README、上传发行包或提交修复直接等同于客户场景的长期运行验证。

## 2. 关键能力对照

| 关注点 | QtScrcpy 开源版 | Escrcpy 当前公开源码 / 文档 | DeviceFarmer STF |
| --- | --- | --- | --- |
| 多设备管理、投屏 | README 明确多设备连接；群控源码维护多个 serial | 文档与源码可确认多设备列表、批量启动镜像 | README 明确设备库存、多设备分配、浏览器远控；不能直接等同同窗同步操作 |
| 同步输入 / 群控 | **源码已证实**：host 输入广播至选定非 host 设备 | README 声称有；当前公开代码核查到基础批处理和数组 ADB 命令，未证实完整广播引擎归属 | 本轮 README/API/控制页没有证实对一组设备广播输入；不据此否定所有扩展可能 |
| 每设备独立任务 | 本轮未见持久化业务任务队列、独立步骤 runner | README/操作文档列可视化自动化和多设备批执行；公开代码/私有扩展边界未逐项公开 | API 可申请/释放设备、取得远程 ADB；外部 runner 可接入，API 文档给 Appium 示例 |
| 定时自动化 | 按键映射含点击序列 delay；这不等于日历定时任务 | 操作指南列“批量计划任务”，未据此证明开源调度器可用 | Booking/Groups 有时间和重复周期，**这是设备预约权限分配**，不等于微信发送定时 |
| 微信发送回读 | 未发现微信专用流程/确认接口 | 未发现微信专用流程/确认接口 | 未发现微信专用流程/确认接口 |
| 截图 / 录制 | 支持截图、屏幕录制，群控层也有截图广播 | 支持批量截图和录制模式 | 有截图/日志/设备远控等能力；本轮未核实通用操作录制与脚本回放 runner |
| 本地 USB | README 明确 | 官方快速上手明确 | README、Compose 文档明确 USB 真机由 Provider 管理 |
| 无线 | README 明确同局域网，USB 初始化后可断开 USB 使用 Wi-Fi | 官方指南明确二维码配对和 IP/端口连接 | README 明确远程 ADB 访问以及 ADB 已连接设备的处理；当前 Compose 快速部署以 USB 为主，不是同等清晰的手机 Wi-Fi 配对桌面向导 |

来源：[Q1][Q3][Q4][E1][E3][E4][E5][S2][S3][S5]。没有把“屏幕录像”当成“录制动作并可靠回放”，也没有把分组预约当成应用业务调度。

## 3. QtScrcpy：开源同步操作有直接源码证据

### 群控如何实现

`QtScrcpy/groupcontroller/groupcontroller.cpp` 的 `GroupController` 维护 `m_devices`，判断 `isHost(serial)`，对非 host 的目标逐个调用底层设备方法：[Q3]

- `mouseEvent`、`wheelEvent`、`keyEvent`：把主设备交互事件传给所选从设备。
- `postTextInput`、`setDeviceClipboard`、`clipboardPaste`：文本与剪贴板操作。
- `postGoBack`、`postGoHome`、`postPower`、`postVolumeUp/Down`：系统按键操作。
- `pushFileRequest`、`installApkRequest`、`screenshot`：文件、安装和截图的批量调用。

这证明它提供的是输入/操作广播；不会因为广播存在，就知道每台设备当前打开的群是否相同、是否出现弹窗、是否成功发送。画面/列表一旦不同步，应用语义仍需独立识别。

### “脚本”能力的具体含义

README 的自定义脚本链接到 `KeyMapDes_zh.md`。文档定义 `KMT_CLICK`、`KMT_CLICK_MULTI`、`KMT_DRAG` 等键鼠映射，以及点击节点 `delay/pos`。它是按键触发的触摸映射或短操作序列，不能当作已有选择器、页面状态机、每天定时、失败续跑的通用 RPA 引擎。[Q4]

### 平台与安装

README 明确 GNU/Linux、Windows、macOS；Windows 发行包包含依赖/ADB，最新 Release 有 Windows x64/x86 ZIP、Ubuntu x64 AppImage、macOS DMG。USB 和 Wi-Fi 操作步骤均明确。直接使用成品的部署复杂度低；自行编译则要 Qt、CMake、子模块等环境，复杂度更高。[Q1][Q2]

README 的剪贴板说明仍提示文本事件方式不支持非 ASCII 字符；中文群名输入应验证所用的剪贴板路径、手机系统和当前发行版，不能从“支持键盘输入”推导全机型中文无问题。[Q1]

**产品边界：** README 推广的 QuickMirror/QuickAssistant 是另外的产品。其“500+手机”“免费版10屏”等描述不作为 QtScrcpy 开源版能力或容量证据。[Q1]

## 4. Escrcpy：基础批量操作有源码，高级特性边界未逐项公开

### 当前公开代码能确认什么

公开 HEAD 的 `desktop/src/views/device/components/batch-actions/index.vue` 枚举了镜像、删除、截图、安装应用、文件推送五种动作；`mirror/index.vue` 对在线去重设备过滤后把数组交给镜像操作 hook。这是批量管理与启动投屏的直接证据。[E3]

`desktop/src/hooks/use-control-action/index.js` 的 `invoke(input, options)` 接受单设备或数组，循环执行预置 ADB 命令，包括主页、返回、音量、方向、通知面板等。这能证明批量 ADB 指令调用，**不能证明鼠标触摸事件的实时广播或独立业务任务调度**。[E4]

`desktop/src/components/control-bar/index.vue` 当前公开映射以系统控制、安装、文件、终端等为主；本轮核查未在这些入口找到完整可视化自动化 runner、持久化计划任务或消息回读实现。[E6]

### README 宣传与私有扩展边界

README-CN 同时有以下内容：[E1]

> “部分高级特性源自私有扩展仓库 EscrcpyX，以付费形式提供。”

功能列表列出“单窗口同控多台设备，广播输入”“自动化脚本，图形化逐步编排工作流，屏幕识图条件判断与多设备批量执行”。`operation.md` 还列出“批量执行脚本”“批量计划任务”。但是本轮资料没有逐一标注这些功能分别属于公开底座还是私有扩展，也没有找到与上述全部宣传项对应的公开实现。[E1][E5]

因此可以写“作者提供/宣传这些功能，部分需私有付费扩展”；不能写“这些均已在 Apache-2.0 开源代码中、可免费二开交付”。是否愿意使用付费成品与是否必须完整开源，是选型时的不同条件。

### 平台与安装

最新 Release 明确有 Windows 安装版/便携版和 Linux DEB/AppImage/Flatpak 等；开发文档列 `build:win/build:linux/build:mac`。官方快速上手有 USB 授权、无线二维码配对、IP 连接。桌面成品部署复杂度低；二开为 Electron/Vue/Node.js，仓库声明使用 pnpm。[E2][E7][E8]

快速上手文档中仍保留早期“Linux/macOS 未预装 scrcpy”的提示，又紧接说明 1.27.1+ 已初步内置；不要只截取旧提示判定当前包一定要手装 scrcpy。[E7]

## 5. STF：设备池基础设施，业务自动化通过外部 runner 接入

### 能确认的用途

README 描述浏览器远程看屏/输入、设备列表、设备在线状态、使用者、管理员、Booking/Partitioning、日志和远程 `adb connect`。API 文档明确定义设备申请/释放和 `remoteConnect` 返回 ADB 可连接地址，并给出 Appium 接入示例。[S2][S3]

这是“设备管理控制面 + 执行器可连接设备”的方向。设备远控、多用户预约与同步镜像鼠标输入不是同一项能力。

### 容易被误认的两个入口

1. README 的 Group/schedule/repetition 指定用户可在某时间占用一组设备，groups-engine 是设备所有权/预约管理。本轮未发现其等同于“每天几点执行微信转发”。[S2][S5]
2. 当前源码确有 `AutomationPane.tsx`，但本次读取到该页面只组合 `StoreAccountCard` 和 `DeviceSettingsCard`。文件夹叫 automation 不能作为已有通用脚本流程 runner 的证据。[S6]

在本轮 README、API、Compose 与该控制页的核查范围，没有证实可直接使用的动作录制/回放、业务脚本 runner 或微信发送回读；没有声称已穷尽整个 STF 生态或所有插件。

### 平台与部署复杂度

README 明确 Windows 本机安装不提供支持，提到 Cygwin 只是未经测试的理论路径；推荐 Linux/BSD 做生产宿主。Windows 用户可以作为浏览器使用者，但不等于 Windows 作为 USB 设备 Provider 宿主已得到官方支持。[S2]

最新仓库有 Docker Compose 官方指南，明确“Linux 宿主 + Docker Compose + USB Android 设备”。服务包括 RethinkDB、ADB、Provider、ZeroMQ Triproxy、Processor、Reaper、Groups Engine、API、WebSocket、存储及 Nginx。Compose 能简化启动，依然是一个需要运维的多服务系统，复杂度高于桌面 ZIP/安装包。[S5]

README 的本地源码依赖含 Node.js、RethinkDB、CMake、GraphicsMagick、ZeroMQ、Protobuf 等；部分手动部署文档沿用较早的 systemd/Docker 示例，实施时优先对照当前 Compose 与对应发行版本，而不是原封不动复制历史机器配置。[S2][S7]

## 6. 对本次需求的选择建议与边界

| 目标 | 最小选择 | 仍需自写/验证 |
| --- | --- | --- |
| 一台电脑人工查看、同步点击多台真机 | QtScrcpy；已证实开源广播能力 | 各机页面是否对齐、中文输入、断连恢复 |
| 管理设备、批量投屏/装包/截图/ADB操作 | Escrcpy 公开底座 | 广播/脚本/定时是否需要 EscrcpyX，采购或二开前逐项验证 |
| 多人跨电脑远程借用设备、需要权限与预约 | STF Linux Provider + Web | 平台部署与外部测试/自动化 runner 接入 |
| 每台手机按自己的群名单独定时转发并回读 | ADB + 每设备 uiautomator2 worker，投屏工具辅助 | 微信适配、独占锁、任务状态、去重、重试与结果不确定处理 |

不能从这些工具的项目星数或 README 的演示设备数推算本机固定容量。单机可接设备数需要按硬件 USB 主控制器、供电、编码/解码和显示策略、连接稳定性及同时执行负载实测；本报告不提供未经测试的固定台数承诺。

## 一手来源

### QtScrcpy

- [Q1] [README](https://github.com/barry-ran/QtScrcpy/blob/f90e2259ea6745c30fc242f501a0210771288f8a/README.md)、[中文 README](https://github.com/barry-ran/QtScrcpy/blob/f90e2259ea6745c30fc242f501a0210771288f8a/README_zh.md)：群控、平台、USB/Wi-Fi、剪贴板与其他产品边界。
- [Q2] [元数据 API](https://api.github.com/repos/barry-ran/QtScrcpy)、[v4.2.1 Release](https://github.com/barry-ran/QtScrcpy/releases/tag/v4.2.1)、[默认分支 HEAD 提交](https://github.com/barry-ran/QtScrcpy/commit/f90e2259ea6745c30fc242f501a0210771288f8a)。
- [Q3] [groupcontroller.cpp](https://github.com/barry-ran/QtScrcpy/blob/f90e2259ea6745c30fc242f501a0210771288f8a/QtScrcpy/groupcontroller/groupcontroller.cpp)：广播事件与批量调用。
- [Q4] [KeyMapDes_zh.md](https://github.com/barry-ran/QtScrcpy/blob/f90e2259ea6745c30fc242f501a0210771288f8a/docs/KeyMapDes_zh.md)：按键映射格式、点击/拖拽/多点击 delay。

### Escrcpy

- [E1] [README-CN](https://github.com/viarotel-org/escrcpy/blob/e35972b46e1ec6724815fd13d1ef1c5b1aa0272f/README-CN.md)：功能宣传及私有 EscrcpyX 收费声明。
- [E2] [元数据 API](https://api.github.com/repos/viarotel-org/escrcpy)、[v3.3.1 Release](https://github.com/viarotel-org/escrcpy/releases/tag/v3.3.1)、[默认分支 HEAD 提交](https://github.com/viarotel-org/escrcpy/commit/e35972b46e1ec6724815fd13d1ef1c5b1aa0272f)。
- [E3] [batch-actions/index.vue](https://github.com/viarotel-org/escrcpy/blob/e35972b46e1ec6724815fd13d1ef1c5b1aa0272f/desktop/src/views/device/components/batch-actions/index.vue)、[batch-actions/mirror/index.vue](https://github.com/viarotel-org/escrcpy/blob/e35972b46e1ec6724815fd13d1ef1c5b1aa0272f/desktop/src/views/device/components/batch-actions/mirror/index.vue)。
- [E4] [use-control-action/index.js](https://github.com/viarotel-org/escrcpy/blob/e35972b46e1ec6724815fd13d1ef1c5b1aa0272f/desktop/src/hooks/use-control-action/index.js)：设备数组及预置 ADB 命令执行。
- [E5] [operation.md](https://github.com/viarotel-org/escrcpy/blob/e35972b46e1ec6724815fd13d1ef1c5b1aa0272f/docs/zhHans/guide/operation.md)：批量操作、脚本和计划任务的文档条目。
- [E6] [control-bar/index.vue](https://github.com/viarotel-org/escrcpy/blob/e35972b46e1ec6724815fd13d1ef1c5b1aa0272f/desktop/src/components/control-bar/index.vue)：公开控制栏入口。
- [E7] [started.md](https://github.com/viarotel-org/escrcpy/blob/e35972b46e1ec6724815fd13d1ef1c5b1aa0272f/docs/zhHans/guide/started.md)：USB/无线连接与平台说明。
- [E8] [develop.md](https://github.com/viarotel-org/escrcpy/blob/e35972b46e1ec6724815fd13d1ef1c5b1aa0272f/develop.md)：Node.js、pnpm 与 Windows/Linux/macOS 构建命令。

### DeviceFarmer STF

- [S1] [元数据 API](https://api.github.com/repos/DeviceFarmer/stf)、[v3.8.0 Release](https://github.com/DeviceFarmer/stf/releases/tag/v3.8.0)、[默认分支 HEAD 提交](https://github.com/DeviceFarmer/stf/commit/be79c0c9546ceb2da761c9ff2ada29d68c1f5f23)。
- [S2] [README](https://github.com/DeviceFarmer/stf/blob/be79c0c9546ceb2da761c9ff2ada29d68c1f5f23/README.md)：设备远控、预约、平台、依赖和 ADB 说明。
- [S3] [doc/API.md](https://github.com/DeviceFarmer/stf/blob/be79c0c9546ceb2da761c9ff2ada29d68c1f5f23/doc/API.md)：设备申请/释放、remoteConnect、外部 Appium 示例。
- [S4] [LICENSE](https://github.com/DeviceFarmer/stf/blob/be79c0c9546ceb2da761c9ff2ada29d68c1f5f23/LICENSE)：Apache-2.0 正文。
- [S5] [Compose 指南](https://github.com/DeviceFarmer/stf/blob/be79c0c9546ceb2da761c9ff2ada29d68c1f5f23/docker/compose/README.md)、[docker-compose.yaml](https://github.com/DeviceFarmer/stf/blob/be79c0c9546ceb2da761c9ff2ada29d68c1f5f23/docker-compose.yaml)：Linux+USB 部署、服务拓扑、group ownership。
- [S6] [AutomationPane.tsx](https://github.com/DeviceFarmer/stf/blob/be79c0c9546ceb2da761c9ff2ada29d68c1f5f23/res/app/src/features/control/panes/automation/AutomationPane.tsx)：当前自动化页的实际组合内容。
- [S7] [DEPLOYMENT.md](https://github.com/DeviceFarmer/stf/blob/be79c0c9546ceb2da761c9ff2ada29d68c1f5f23/doc/DEPLOYMENT.md)：Provider/ADB/多进程与 systemd 部署。

未进行真实设备或软件安装验证；本轮没有穷尽插件、私有扩展或第三方分支，以上“未发现”均限定在明确列出的公开资料范围。
