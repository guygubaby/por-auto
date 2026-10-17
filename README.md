# por-auto

Tauri 2 + Vue 3 + Vue Router 文件路由 + Pinia + TypeScript + Tailwind CSS v4 的 Android 自动化桌面工具。界面参考 VoxRelay 的深色侧栏与状态卡片。当前提供手机环境初始化、ADB 设备发现、多手机工作流执行、uiautomator2 手机自动化、截图结果、GitHub 工作流商店和本地 Cron 定时任务。

**不需要后端服务。** 桌面 Rust 代码直接连接手机及 GitHub；所有配置、已安装工作流和执行结果保存在用户本地。客户无须安装 Python、Node.js、Rust、Git 或 Android Studio。

## 客户试用

Windows 10/11 x64 安装包生成后位于 `deliverables/`。使用步骤见 [客户试用说明](deliverables/客户试用说明.md)。

1. 安装软件，首次打开点击「初始化连接组件」。ADB 随软件附带；缺少 WebView2 时由安装器联网补齐。
2. 手机开启 USB 调试、通过数据线连接，在手机上允许该电脑调试；保持解锁、微信已登录并使用简体中文。
3. 点击「刷新设备」，勾选一台或多台已授权手机（支持全选），选择「读取微信昵称」并点击「运行工作流」。最多同时运行 4 台，同一手机任务按到达顺序排队，一台失败不影响其他手机。
4. 软件显示步骤进度；在「运行结果」选择手机查看对应昵称、错误与截图。点击「打开结果目录」查看 JSON、截图和页面结构。

部分 Windows 手机需品牌官方 USB 驱动。手机端 USB 调试授权、解锁和微信登录需要用户完成。当前试用包没有商业代码签名证书，Windows 可能提示未知发布者。

## 工作流商店

默认源为本仓库：`https://github.com/guygubaby/por-auto`，分支 `main`，固定读取 `workflows/registry.json`。

在软件中粘贴其他 GitHub 仓库根地址、填写分支或标签并同步，即可安装该仓库的标准工作流。私有仓库需要有访问权限的 GitHub 令牌（Contents 只读）；令牌仅用于本次同步，不保存到磁盘、不嵌入客户端。默认附带 4 个工作流，无令牌也能离线试用。

更新流程：新增或修改 `workflows/<id>/workflow.json` → `pnpm registry:index` → 提交并推送 → 客户在商店刷新并安装更新。已安装版本不会被目录刷新直接替换；工作流使用现有引擎动作时无需重新发布软件。

完整格式、支持动作、限制和目录约定见 [工作流开发说明](workflows/README.md)。当前附带 `wechat-nickname`（昵称）、`wechat-open`（打开微信）、`wechat-first-chat`（打开首个会话）和 `wechat-send-hello`（发送你好）。

## AutoJs6 手机脚本更新

手机可使用官方 AutoJs6 6.7.0+ 独立运行 JS。导入 [固定启动器](mobile/autojs6/bootstrap.js) 后，启动时检查 GitHub 脚本目录，也可手动更新、安装或导入离线包。启动器内置不操作微信的测试示例；业务脚本更新不需要重新安装 AutoJs6 或 PC 软件。

脚本位于 `mobile-workflows/<id>/src/`。修改后增加 `workflow.json` 的 `versionCode`，执行 `pnpm mobile:bundle`、`pnpm test:mobile` 和 `pnpm mobile:check`，提交生成文件后发布。下载按单个 Git 提交固定来源，逐文件校验 SHA-256，完整写入新版本目录后原子切换；配置和日志独立保存。运行与更新互斥，失败不自动重试业务任务。

构建同时生成 `deliverables/PorAuto-AutoJs6-bootstrap.js` 与 `deliverables/PorAuto-mobile-scripts.json`，后者可由 PC 传到手机离线导入。私有仓库令牌仅在当前启动器会话使用。完整使用、脚本入口约定及限制见 [手机脚本说明](mobile-workflows/README.md)。本轮未添加 PC 图形化安装/同步按钮或 PC→AutoJs6 任务通信。

## 首个会话发送示例（0.2.1 / 引擎 2）

1. 升级到 0.2.1，在「设备与运行」选择一台测试手机。新流程内置，无需联网同步商店。
2. 先运行「打开微信首个会话」，在结果中核对会话名称和截图。第一个会话是**运行时列表滚动到顶部后的第一项，包含置顶**，不是预先保存的固定联系人。
3. 选择「向首个会话发送你好」，点击「运行并发送」。软件回到会话列表顶部，读取第一项名称、进入会话并核对标题，通过 uiautomator2 输入中文，校验内容后只点击一次发送。
4. 在结果中查看会话、发送内容、发送状态和截图；异常时导出记录，包含发送前后页面结构和服务日志。已有草稿、空列表、页面歧义或非普通会话会停止；发送超时/结果不明不会自动重试，请先人工检查，直接重跑可能再次发送。

Rust 通过 ADB 启动官方 `android-uiautomator-server-jar` 0.4.0，并经独立端口转发调用 JSON-RPC（与 uiautomator2 Python 客户端使用相同手机端服务），不再调用 Android 的 `uiautomator dump` 命令。客户无需安装 Python，构建和运行时校验服务的固定 SHA-256，任务结束后停止服务并移除转发。上游服务在运行期间监听手机 9010 端口且没有身份认证，应使用可信网络；没有常驻安装手机 APK。

队列在 Rust 中执行，同手机 FIFO、全局最多 4 台并发，手动运行和 Cron 共用。进程退出后不会恢复内存队列，也不会自动重发。当前仍未包含 scrcpy 投屏、人工接管、按设备暂停/继续或断点恢复；这不是完整群控方案已全部完成。发送状态仅代表输入框清空且页面看到新的右侧消息，**不代表网络送达或对方已读**。

本轮通过合成页面结构测试验证保护分支；尚无连接的真机，实际微信版本、品牌手机和系统权限需要真机适配确认。

## 本地开发与打包

需要 Node.js 24、pnpm、Rust 1.93.1，以及 Tauri 对应平台的开发工具。客户机器不需要这些环境。

```sh
pnpm install
pnpm prepare:adb macos        # Windows 开发时改为 windows
pnpm prepare:u2               # 下载并校验固定版本的手机端服务（3.54 MiB）
pnpm tauri dev
```

```sh
pnpm build                   # Vue / TypeScript 检查与前端构建
pnpm test:adb-paths          # POR_ADB_TEST_BINARY 指向已解压的 ADB，无手机复现 Windows 路径问题
pnpm test:devices            # 多设备选择迁移、最多 4 台并行、事件隔离与失败后继续
pnpm test:schedules          # 定时任务界面状态、防重复提交与旧响应隔离
pnpm test:updates            # 更新状态、版本与多平台发布清单
pnpm registry:check          # 索引与 SHA-256 一致性
cargo test --manifest-path src-tauri/Cargo.toml
pnpm build:mac               # macOS App / DMG
pnpm build:windows           # Windows 本机或已配置的 macOS 交叉构建
```

如构建机已有官方 platform-tools ZIP，可设置 `POR_ADB_ARCHIVE` 指向本地文件；脚本仍校验固定版本的官方散列。macOS 交叉构建需要 `cargo-xwin`、xwin 缓存、LLVM 和 NSIS。普通 main 分支提交触发 Windows 试用安装包构建，产物位于 Actions Artifact；版本标签另触发下述正式 Release。

## 应用内更新与 GitHub Release

右上角版本按钮打开「软件更新」，可查看版本说明、检查更新、下载进度及「下载更新并重启」。默认在启动及每 6 小时检查一次，可关闭自动检查；发现新版本后仍由用户选择安装。设置保存在本机 `update-settings.json`，更新不清除 Registry、已安装工作流、定时任务和日志。工作流或维护操作运行时阻止安装更新。

更新源为本公开仓库 Release 的 `latest.json`，不需要后端或客户的 GitHub 令牌。使用 Tauri 官方 Updater，客户端只接受 HTTPS 下载及配置公钥签发的更新，并验证签名中绑定的版本号。网络、下载或签名失败会显示错误，保留当前版本。旧的 0.1.0 试用包没有更新器，需先手动安装 0.1.1 或更新版本。

发布流程：

1. 同时修改 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 的版本，在 `CHANGELOG.md` 添加对应版本说明。运行 `pnpm release:check --tag v<版本>`。
2. 提交并推送代码，然后推送匹配的 `v<版本>` 标签（例如 `v0.1.1`）。`.github/workflows/release.yml` 在原生 Windows/macOS Runner 构建 Windows x64、Mac Apple Silicon 和 Intel 安装包及更新签名。
3. 全部平台构建成功才生成 `latest.json` 并发布为最新稳定 Release。缺任一平台、签名文件或版本不一致均停止发布；已发布的版本不覆盖，修复需提高版本号。手动重跑时填写已有标签。

GitHub Actions 使用仓库 Secret `TAURI_SIGNING_PRIVATE_KEY`（已配置）；如私钥带密码，同时配置 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。当前构建机私钥位于仓库外 `~/.config/por-auto/updater.key`，需妥善备份，不能提交到 Git。客户端只包含公钥。更新签名与 Apple 公证、Windows 代码签名是不同机制，当前包没有商业系统签名。

本机打包也需设置签名环境变量（Tauri 不读取 `.env` 中的这些值）：

```sh
export TAURI_SIGNING_PRIVATE_KEY="$HOME/.config/por-auto/updater.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
pnpm build:mac
```

官方参考：[Tauri Updater](https://v2.tauri.app/plugin/updater/)、[GitHub 构建分发](https://v2.tauri.app/distribute/pipelines/github/)。

## 源码结构

```text
src/pages/                   文件路由页面：设备、结果、定时任务、记录、商店、指引
src/                         Vue 组件与共享 Pinia 状态
src-tauri/src/android.rs      ADB 调用和设备发现
src-tauri/src/u2.rs           官方 uiautomator2 Android 服务生命周期与 JSON-RPC
src-tauri/src/wechat.rs       微信首个会话定位、草稿保护、中文输入与单次发送
src-tauri/src/jobs.rs         按设备 FIFO 队列、最多 4 台并发与维护互斥
src-tauri/src/workflow.rs     JSON 工作流校验与执行
src-tauri/src/registry.rs     GitHub 源同步、校验、本地安装快照
src-tauri/src/schedule.rs     Cron 校验、时区、任务持久化、触发与重叠保护
src-tauri/src/updater.rs      GitHub 更新检查、签名安装与本机偏好
workflows/                   标准工作流及索引（默认 registry）
scripts/                     索引生成、ADB 组件准备和打包
outputs/                     早期调研与方案
wechat_demo.py               早期 Python 命令行原型，桌面端不依赖它
```

Windows 配置与运行记录位于 `%LOCALAPPDATA%/com.por.wechatreader/`；macOS 位于系统分配的应用用户数据目录。`workflow-store.json` 保存工作流源和安装快照，`schedules.json` 保存定时任务与执行游标，`runs/<运行ID>/` 保存结果；设备与工作流选择保存在本机 WebView 存储中。GitHub 令牌不写入上述位置。

当前微信流程仅适配简体中文原版微信；页面不同、同名节点歧义、未登录或锁屏时会停止并尽力保留证据。真实手机兼容性须按客户手机验证，单元测试和界面预览不等于真机成功。

## 运行日志与调试导出

每次执行会立即保存工作流快照和运行元数据，按步骤追加 `events.jsonl`，记录开始/完成时间、错误与截图提示。结束后写入 `result.json`；进程意外退出时，已写入的日志仍保留，列表显示“未完成 / 中断”。

「运行记录」页面可查看逐步日志、多选记录、导出调试 JSON、删除所选或清空记录。删除前确认，日志、截图与页面结构一并清理。每次导出最多 100 条，通过系统保存对话框选择文件；JSON 包含日志、错误、工作流快照/版本、Git 提交和已有截图/页面结构，不包含 GitHub 令牌。全部操作在本机完成。

## Cron 定时任务

在「定时任务」新建任务，选择已安装工作流、一台或多台手机、五段 Cron 和 IANA 时区（默认电脑时区）。支持预览未来 5 次执行时间、编辑、启停、立即执行、删除和按任务查看日志。最多保存 100 个任务，每个任务最多 1000 台手机。离线手机仍保留在任务中，失败后继续处理其他设备。

| 表达式 | 执行时间（按任务时区） |
| --- | --- |
| `0 9 * * *` | 每天 09:00 |
| `0 9 * * 1-5` | 周一至周五 09:00 |
| `0 * * * *` | 每小时整点 |
| `*/30 * * * *` | 每小时的 00 和 30 分 |

格式为 `分 时 日 月 周`。支持 `*`、列表、范围、步长及月份/星期缩写，周日为 0 或 7；日与星期均受限时使用 Vixie 的 OR 语义。六段/七段、Quartz 扩展和 `@daily` 等别名不在本软件格式内。夏令时缺失时刻跳过，重复本地时刻只执行第一次。

调度器在 Rust 层每秒检查一次，切页、刷新前端或最小化不影响任务；必须保持客户端运行、电脑唤醒及手机连接。退出软件后停止，重启只计算未来时点，不补跑、不自动重试。正常调度有 10 秒宽限；电脑休眠或延迟超过宽限时跳过该轮，并记录原因。同一任务不重入；不同手机最多 4 台并发，同一手机的任务排队，等待中的任务也阻止维护/更新。单设备队列最多 16 项，超过时记录失败。维护期间不启动设备任务。暂停只停止未来触发，当前批次继续完成；暂停的任务仍可手动「立即执行」。

每个任务保存完整工作流快照、版本和 Git 提交，商店更新不会静默更换任务脚本。编辑同一工作流时继续保留旧快照；如检测到已安装版本变化，可明确勾选更新快照。保存配置使用临时文件、同步落盘与原子替换；到点时先保存下一个执行游标，再启动批次，防止进程中断后重复触发。客户端启用单实例，避免多个窗口进程重复调度。

每次触发均生成批次记录，包含任务 ID、名称、触发方式、计划时点、所选手机、快照和逐设备结果链接；实际设备执行另有步骤日志、结果与截图。跳过、部分失败也可按任务筛选、批量导出和清理。删除任务不删除历史。配置损坏会显示调度器错误并停止调度，保留原文件供排查；进程中断的任务不会自动重试。

当前没有操作系统常驻服务、自动开机启动或关机唤醒功能。给客户验收时可用 `* * * * *` 和一台测试手机确认分钟触发、最小化执行、暂停、重启不补跑与 JSON 导出，再恢复正式执行频率。
