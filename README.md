# por-auto

Tauri 2 + Vue 3 + TypeScript + Tailwind CSS v4 的 Android 自动化桌面工具。界面参考 VoxRelay 的深色侧栏与状态卡片。当前提供手机环境初始化、ADB 设备发现、微信昵称读取、截图结果，以及 GitHub 工作流商店。

**不需要后端服务。** 桌面 Rust 代码直接连接手机及 GitHub；所有配置、已安装工作流和执行结果保存在用户本地。客户无须安装 Python、Node.js、Rust、Git 或 Android Studio。

## 客户试用

Windows 10/11 x64 安装包生成后位于 `deliverables/`。使用步骤见 [客户试用说明](deliverables/客户试用说明.md)。

1. 安装软件，首次打开点击「初始化连接组件」。ADB 随软件附带；缺少 WebView2 时由安装器联网补齐。
2. 手机开启 USB 调试、通过数据线连接，在手机上允许该电脑调试；保持解锁、微信已登录并使用简体中文。
3. 点击「刷新设备」，选择已授权手机与「读取微信昵称」，点击「运行工作流」。
4. 软件显示步骤进度、真实昵称和结束时截图。点击「打开结果目录」查看 JSON、截图和页面结构。

部分 Windows 手机需品牌官方 USB 驱动。手机端 USB 调试授权、解锁和微信登录需要用户完成。当前试用包没有商业代码签名证书，Windows 可能提示未知发布者。

## 工作流商店

默认源为本仓库：`https://github.com/guygubaby/por-auto`，分支 `main`，固定读取 `workflows/registry.json`。

在软件中粘贴其他 GitHub 仓库根地址、填写分支或标签并同步，即可安装该仓库的标准工作流。私有仓库需要有访问权限的 GitHub 令牌（Contents 只读）；令牌仅用于本次同步，不保存到磁盘、不嵌入客户端。默认附带昵称工作流，无令牌也能离线试用。

更新流程：新增或修改 `workflows/<id>/workflow.json` → `pnpm registry:index` → 提交并推送 → 客户在商店刷新并安装更新。已安装版本不会被目录刷新直接替换；工作流使用现有引擎动作时无需重新发布软件。

完整格式、支持动作、限制和目录约定见 [工作流开发说明](workflows/README.md)。目前有 `wechat-nickname` 和 `wechat-open` 两个示例。

## 本地开发与打包

需要 Node.js 24、pnpm、Rust 1.93.1，以及 Tauri 对应平台的开发工具。客户机器不需要这些环境。

```sh
pnpm install
pnpm prepare:adb macos        # Windows 开发时改为 windows
pnpm tauri dev
```

```sh
pnpm build                   # Vue / TypeScript 检查与前端构建
pnpm registry:check          # 索引与 SHA-256 一致性
cargo test --manifest-path src-tauri/Cargo.toml
pnpm build:mac               # macOS App / DMG
pnpm build:windows           # Windows 本机或已配置的 macOS 交叉构建
```

如构建机已有官方 platform-tools ZIP，可设置 `POR_ADB_ARCHIVE` 指向本地文件；脚本仍校验固定版本的官方散列。macOS 交叉构建需要 `cargo-xwin`、xwin 缓存、LLVM 和 NSIS。仓库同时提供 Windows GitHub Actions 构建，产物为私有仓库的 Actions Artifact，不会自动公开发布。

## 源码结构

```text
src/                         Vue 界面、工作流商店、手机连接与结果
src-tauri/src/android.rs      ADB 调用、设备与 UI 树
src-tauri/src/workflow.rs     JSON 工作流校验与执行
src-tauri/src/registry.rs     GitHub 源同步、校验、本地安装快照
workflows/                   标准工作流及索引（默认 registry）
scripts/                     索引生成、ADB 组件准备和打包
outputs/                     早期调研与方案
wechat_demo.py               早期 Python 命令行原型，桌面端不依赖它
```

Windows 配置与运行记录位于 `%LOCALAPPDATA%/com.por.wechatreader/`；macOS 位于系统分配的应用用户数据目录。`workflow-store.json` 保存工作流源和安装快照，`runs/<时间戳>/` 保存结果；设备与工作流选择保存在本机 WebView 存储中。GitHub 令牌不写入上述位置。

当前读取流程仅适配简体中文原版微信；页面不同、同名节点歧义、未登录或锁屏时会停止并尽力保留证据。真实手机兼容性须按客户手机验证，单元测试和界面预览不等于真机成功。
