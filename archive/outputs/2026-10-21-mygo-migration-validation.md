# MyGo / React 迁移验收（0.4.0 预览）

> Historical report. Visual-model execution was removed after this validation. Current native-only behavior, package versions and device evidence are in `outputs/2026-10-22-native-only-validation.md`.

## 实现范围

桌面入口已改为 MyGo v0.6.0 + 系统 WebView + Go 1.27.1，前端使用 AGENTS.md 指定的 React SPA 栈。Rust / Tauri、Vue / Pinia 的源码与活动构建入口已移除。现有 Kotlin 输入 APK 与 uiautomator2 提示状态补丁保留，哈希继续由构建脚本校验。

保留 JSON 工作流、手机共享 JS 控制器、HTTP / Hook、每设备 FIFO、全局四台并发、Cron 版本与配置快照、已有草稿保护、单次输入 / 发送和结束时恢复键盘。Go 宿主通过 goja 运行共享控制器，手机已有行为无需重新实现一套。

七个页面为工作台、运行结果、定时任务、运行记录、工作流商店、设置、使用指引。已应用 shadcn preset `b2h2bVtx6G`（Radix Vega / Mist / 大圆角与本地字体）；页面、卡片、侧栏使用白色 / 中性黑灰底色，浅紫色仅作强调。浅色 / 深色 / 跟随系统三种模式可持久保存并响应系统外观变化。所有 13 处下拉菜单改用统一的 shadcn / Radix 控件，保留键盘操作与表单绑定；左侧激活菜单右侧的小圆点已移除。

桌面和手机 AI 接口直接支持 HTTP、HTTPS，不强制 HTTPS，也没有额外协议许可开关。密钥继续保存在系统凭据库或手机 Keystore，并与接口地址绑定。图像请求独立支持 5–600 秒超时；业务 HTTP 保持原有策略。新接口与两模型检查见 `outputs/2026-10-21-model-provider-validation.md`。

Motion 用于页面进入、侧栏与筛选滑块、卡片反馈、主题图标和下拉展开。滑块移动保持在控件内部，尊重减少动态效果偏好。React 使用 TanStack Router 管理地址状态、Query 管理服务状态、Zustand 管理少量客户端偏好、React Hook Form + Zod 管理表单。

## 已完成的检查

| 检查 | 结果与边界 |
| --- | --- |
| TypeScript / Vite 正式构建 | 通过，React 19 / Vite 8 / Tailwind v4 |
| React 单元测试 | 8 / 8；主题三态、系统变更、清理监听、批次失败隔离、HTTP JSON 草稿与旧接收配置迁移 |
| 浏览器回归 | 5 / 5；七个页面、配置对话框、自定义下拉与 HTTP 表单、三种主题、390 px 布局；逐帧检查快速切换与内容高度变化时滑块不偏移，并验证减少动态效果；新增千条历史 / 对象与 500 条日志的分页、延迟渲染及 URL 页码检查；Codex 浏览器确认中性底色、统一下拉及侧栏无激活圆点 |
| 手机共享核心回归 | 71 / 71；原生输入所有权、草稿保护、视觉定位、逐对象 HTTP、发送不重放、1000 个目标、定时快照与失败恢复、企业微信 5.0.12 控件映射，HTTP / HTTPS 模型地址，以及严格 JSON 对末尾模型标记的兼容 |
| Go 引擎回归 | `go test -race ./internal/...` 通过；包含 Go / JS 协议、共享工作流、HTTP 鉴权与无重定向重放、FIFO / 四台并发、Cron / DST、保存失败回滚、原生页面解析、焦点弹窗归属、仅对空焦点的有界等待、旧诊断排除二进制图像和发送提交保护 |
| 本机旧数据兼容 | 使用旧数据复制件验证 workflow-store.json、schedules.json、vision-provider.json；保持旧凭据引用与地址绑定；原数据目录未参与测试写入 |
| MyGo 系统 WebView | 实际 macOS App 启动与 Go IPC、ADB 初始化、三种主题的 DOM / color-scheme / 本机保存、设置路由均通过；测试数据使用独立目录 |
| MyGo 离线定时 | 通过实际 WebView IPC 新建并手动触发只读工作流；不存在的测试设备记录失败并释放队列，保留批次与设备记录，然后删除本次测试任务 |
| 发布校验 | 两项测试通过；三平台缺件、版本不一致、归档内容改动导致的签名失败均阻止发布 |
| 三平台试用包 | macOS arm64 / amd64 DMG 与 Windows x64 NSIS 均重新构建，包含当前 shadcn preset、中性背景、下拉控件、Motion、手机包 51 / 35 和 Go 修复；Mac App 通过 ad-hoc 完整性校验 |

系统 WebView 报告位于 `work/native-webview-cache/preset/native-report.json`，通过可见自定义下拉的键盘操作检查三种主题。历史列表、对象结果和展开日志均每页 50 条，图片延迟解码；界面与性能复核见 `outputs/2026-10-21-ui-performance-review.md`。浅深色预览见 `outputs/2026-10-21-theme-preview.png`，下拉与侧栏截图见 `outputs/2026-10-21-dropdown-preview.png`。原生回归入口仅在 `desktoptest` 构建标签下启用，正式试用包不包含该入口。

## 新 Go 宿主的真机预演

设备为已授权的 vivo X21 / Android 9，微信 8.0.79、企业微信 5.0.12。所有设备测试强制预演，未点击发送；只有 Cron 检查使用本机测试 HTTP 服务，未调用客户业务回调。Go 验收使用隔离目录；按用户要求把新模型保存到了手机与桌面正式模型配置，密钥加密保存，已有工作流配置和定时快照不变。

| 流程 | 结果 |
| --- | --- |
| 微信打开、读取昵称、打开首个会话 | 通过，视觉执行 |
| 微信文件传输助手 | 通过，输入「1」、完整回读、清理本轮文字；恢复原键盘与 USB 唤醒设置 |
| 企业微信打开、读取姓名、首个普通会话 | 通过，使用原生控件 |
| 企业微信指定群中文预演 | 通过，核对目标、写入中文、完整回读并清理；恢复原设置 |
| 手机独立企业微信四个工作流 | 构建附带微信手机包 51 / 企业微信手机包 35；此前企业微信包 28 的打开、姓名、首个会话、指定群中文预演连续通过，原键盘恢复，未发送消息 |
| 手机独立分钟 Cron | 企业微信手机包 28 通过真实分钟边界触发，执行一次后停用；使用原生模式，无需截图授权，原键盘恢复 |
| 实际分钟 Cron / HTTP | 通过，原生「打开企业微信」在真实分钟边界触发；修改当前配置后仍使用已保存快照，GET 前置请求、带鉴权 POST 后置请求和 `rehearsal` 上下文均正确，结束后停用测试任务 |
| 实机停止与运行记录 | 通过，在只读任务等待步骤停止，确认设备队列释放；随后同一手机再次运行成功，两个状态均记录，详情与 JSON 导出完整；删除隔离的停止记录后，成功记录保留 |
| 额外草稿拒绝覆盖检查 | 本地 WorkBuddy 模型下通过；实际写入与完整回读、拒绝覆盖、清理本轮草稿、恢复原键盘均通过，未发送 |
| 微信完整群 / 会话列表 | 通过：12 个群、14 个首页会话，确认末尾、无重复、未输入消息 |
| 微信长群名预演 | 原始截图显示标题完整；模型曾把返回按钮未读数或隐藏文字误并入标题。严格校验均阻止输入，相关 OCR 用例已覆盖；当前新包仍需重跑正向多群预演 |

已完成 9 个附带工作流中的 8 个独立真机预演。对应报告保留在 `work/go-device-cache/` 的 `first`、`acceptance`、`input`、`wecom-profile`、`wecom-rehearsal`、`wecom-pass` 与 `cron-native` 下；这些目录也包含修复前失败，不能把整个目录视为全部通过。早期群聊失败记录在 `groups-authorized`；新模型的额外草稿保护检查位于 `guard-new-key`、`guard-protocol-43`、`guard-mimo-final`、`guard-minimax-final` 与 `guard-workbuddy-45`，每个目录须按实际结果判断；最后一项已通过。手机画面与会话名仅保存在忽略的本机证据目录。

真机回归修复并补充定向测试：视觉请求不再误用业务请求 64 KiB 上限，恢复原有画面协议与高精度图像参数；搜索结果必须有本机头像依据；企业微信 5.0.12 使用版本化控件映射，完整导航与聊天标题确认后才操作；原生 JSON-RPC 显式使用 UTF-8，修复中文输入被解码为替换字符。已有草稿保护与发送不重放的共享核心和 Go 单元检查通过，但不能替代上述尚未完成的新宿主真机检查。

用户提供的新密钥已在电脑和手机加密保存。`cline-free/minimax-m3.1-flash` 与已获用户确认的 `mimo-v2.6-flash-free` 按验收任务交替；原 `cline-free/mimo-v2.6-flash` 虽列在模型目录，却由上游返回 404 / model not found。MiMo 有时在完整 JSON 后追加 `<|im_end|>`，现在仅兼容一个精确末尾标记，不接受额外文字、截断数据或重复标记。实际请求仍有耗时波动，固定色块测试不能替代完整流程验收。

本轮还根据真实搜索画面明确区分「功能」下的本地文件传输助手与网络建议；继续要求完整名称、头像依据和点击前画面稳定。Go 端遇到空焦点时最多进行四次只读检查，其他应用、锁屏、ADB 错误与取消立即停止。手机画面和会话名只保存在忽略的本机证据目录。

根据用户最新要求，桌面图像接口已切换为本机 `http://127.0.0.1:3425/v1` 的 `workbuddy-ai/deepseek-v4.1-flash`，实际微信截图识别与连接测试均通过；凭据继续存于系统 Keychain。新的 Go 文件传输助手与原生草稿保护验收约 97 秒完成。手机若临时转发使用该电脑服务，会在报告标注模型依赖。

## 数据与升级

macOS 继续使用 `~/Library/Application Support/com.por.wechatreader`，Windows 继续使用 `%LOCALAPPDATA%/com.por.wechatreader`。已安装快照、卸载标记、定时与凭据引用保留；刷新目录不替换已安装代码。前端刷新不会取消已开始的手机任务，界面会重新读取后台进度。

MyGo 与旧 Tauri 的更新包格式不同，0.3.x 用户需要手动安装一次。更新公钥身份保留，但 CI 需要配置匹配的 MyGo 格式私钥；本次安装包供手动试用，没有发布正式 Release，也没有商业系统签名。

## 尚未完成的验收

仍需完成新 Go 宿主的多群正向预演。微信群和首页会话的完整列表验收已经通过。额外草稿保护真机检查已在 `guard-workbuddy-45/input-guard/input-guard-acceptance.json` 通过。取消 / 队列释放已通过实机只读工作流检查，本轮没有在实际输入进行中做强制取消测试。独立 AutoJs6 的企业微信 5.0.12 四个工作流与原生分钟 Cron 已通过；当前包 35 的原生流程和包 51 的视觉流程继续回归；不会用旧版本通过记录代替当前版本全量验收。

正式发送与实际网络送达未验证。Windows 仅做构建与安装包检查，未在 Windows 实机运行。未宣称迁移后的全部功能已完成真机验收。

## 界面指导依据

已应用 Modern Web Guidance 的 `forms`、`accessibility` 与 `color`：表单保留关联标签、错误反馈和键盘焦点；主题采用媒体查询并遵循减少动态效果偏好。颜色指导要求为 “Maintain 4.5:1 for normal text and 3:1 for large text or icons.”；浅深色正文、辅助文字、强调色及输入边框已做对比度核对，强制颜色模式使用系统语义色。

## 本地试用包

- Apple Silicon：`deliverables/PorAuto-0.4.0-macos-arm64.dmg`，24.28 MiB。
- Intel Mac：`deliverables/PorAuto-0.4.0-macos-amd64.dmg`，25.08 MiB。
- Windows x64：`deliverables/PorAuto-0.4.0-windows-amd64-setup.exe`，16.93 MiB。
- SHA-256：`deliverables/SHA256SUMS-0.4.0.txt`。

正式试用构建的 Go 元数据已确认不含 `desktoptest`；两种 Mac App 均通过 ad-hoc codesign 完整性检查。Windows EXE / NSIS 已完成交叉构建；这不等于 Windows 实机验收。
