# PorAuto Agent（Android APK）

> 部署与发版总览见 [../devops.md](../devops.md)。

手机 AI 助手：说一句话，AI 看着当前屏幕一步步操作 App。企业微信群发是内置的专用工作流。
单个 APK，装完即用。

## 界面

五个底部标签，默认打开「助手」：

| 标签 | 作用 |
|---|---|
| 助手 | 一句目标交给 AI，按当前屏幕一步步操作：点击、长按、输入、回车、滚动、整屏滑动、返回、回桌面、最近任务、通知栏、按应用名打开 App；每轮保留执行步骤和结果，随时可停，不可撤销的操作会被拦下 |
| 群发 | 选范围（群聊 / 单聊 / 全部）→ 填消息 → 试运行（只写草稿再清理）→ 正式发送（只点一次并回读）；中途失败可以只补发剩下的会话 |
| 定时 | 每天固定时间执行一次群发（范围自选）；暂停 / 立即运行 / 删除 |
| 日志 | 每次运行的时间、类型、成功失败数；展开看每个会话的结果 |
| 设置 | 无障碍状态、悬浮读屏按钮、通知按钮、精确闹钟；「AI 配置」点进去是独立页面；调试 JSON、版本 |

界面用 Compose Material 3 + 自带设计层：`Theme.kt` 统一配色（暖纸张底 / 近黑主色 / 琥珀强调）、
字体比例、圆角和 `Space` 间距；`Components.kt` 提供 `AppHeader`、`Section`、`SettingRow`、
`CompactButton`、`ScopePicker`、`StatusDot`、`EmptyState`。所有页面都按状态栏 / 导航栏 insets
留白（edge-to-edge），AI 配置页单独处理 IME inset。

## App 图标

采用已确认的 B 方案：明黄背景、黑猫主体与纸飞机配饰。

- `branding/logo-master.png`：1024×1024 满版原稿，不含展示用灰底、圆角边框或外投影。
- `branding/logo-production-prompt.txt`：原稿整理提示词，不含接口凭据。
- `app/src/main/res/drawable-nodpi/ic_launcher_foreground.png`：432×432 自适应图标图层；原稿缩至 272×272 后四周各延展 80px，避免关键表情被裁掉或出现内嵌边框。
- `app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`：桌面图标与圆形图标共用；通知小图标仍保留独立的功能性图案。

## 助手

一句话目标 → 读当前屏幕 → 模型给一个 JSON 动作 → 执行 → 回读画面 → 把结果喂回下一轮。
动作覆盖点击 / 长按 / 输入 / 回车 / 滚动 / 整屏滑动 / 返回 / 回桌面 / 最近任务 / 通知栏 /
按应用名或包名打开 App / 等待；完成和放弃由模型显式给出。

安全边界：

- 只操作前台可见界面，锁屏或切走就停；不截图，读到的控件树只发给配置的模型；
- 密码框只读提示文字，内容不回传、不写进日志；
- 付款、转账、删除、注销、卸载这类不可撤销的操作，目标里没有提到就拦下；
- 失败会带着原因让模型换做法：重复动作 3/6 次、画面连续 3/6/9 步没变化、连续 2/4 个动作失败时先提醒；
  一直到 12 次重复、12 步没进展、8 次连续失败或满 120 步才停（阈值参考 phongent 的 GuardRules）。

## AI 配置

设置 → AI 配置（独立页面，左上角返回）：

1. 选 `OpenAI 兼容`、`Anthropic 兼容` 或 `OpenCode Go`（选了会自动填好 Base URL）；
2. 填 Base URL（如 `https://api.deepseek.com/v1`；OpenCode Go 是 `https://opencode.ai/zen/go/v1`）；
3. 填 API Key（Keystore 加密保存，留空表示不修改）；
4. 点「获取模型」，从列表里选一个；
5. 点「保存并测试」，通过后群发页就能用「AI 生成」：一句话同时填好消息正文和范围，仍需自己试运行确认。

留空复用 Key 仅限相同协议和 Base URL；变更接口时必须重新填写 Key。接口重定向不会自动跟随，避免凭据被带到其他地址。加密保存失败时保留原配置并显示错误。

只允许两种协议：OpenAI 的 `/chat/completions` + `/models`，Anthropic 的 `/messages` + `/models`。
OpenCode Go 走 OpenAI 协议，但按它的要求额外发送应用自己的 `User-Agent: PorAuto-Agent/0.1.0`
和安装后固定不变的 `x-opencode-session` 会话头（首次使用时生成 UUID 并保存）。
Debug 包的明文 HTTP 只对 `127.0.0.1 / localhost / 10.0.2.2` 放行，接本地网关时可用 `adb reverse tcp:3425 tcp:3425`。Release 包只允许 HTTPS。

## 构建

```sh
cd android
ANDROID_HOME=$HOME/Library/Android/sdk ./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### 正式签名包（交付测试用）

签名证书是真实的 4096 位 RSA 证书（CN=PorAuto Agent），有效期 30 年，打出来的包不 debuggable、
v2 + v3 签名，可以直接装到手机上。

```sh
cd android
ANDROID_HOME=$HOME/Library/Android/sdk ./gradlew :app:assembleRelease
cp app/build/outputs/apk/release/app-release.apk dist/PorAuto-Agent-0.1.0-release.apk
$HOME/Library/Android/sdk/build-tools/35.0.0/apksigner verify --print-certs dist/PorAuto-Agent-0.1.0-release.apk
```

- keystore 存放在仓库外：`~/.por-auto/por-auto-release.jks`（别删，删了以后装不上覆盖更新），
  口令在同目录的构建机文件 `android/keystore.properties`（已 gitignore）。
- 换一台机器构建时，把 `.jks` 拷过去，按 `storeFile / storePassword / keyAlias / keyPassword`
  重建 `keystore.properties` 即可；没有该文件时 release 任务产出未签名包。
- 证书 SHA-256：`922f3b9f3b2403ccfc81de42d43e404602ad99cd3ccdbfbbfb8dc7c143167ca5`。
- 签名和 debug 包不同，同一台机器上装过 debug 包的测试机要先卸载旧包。

## 测试

单元测试（JVM，不依赖设备）：

- `WecomTitleTest`：标题比对（群成员数后缀、省略号、全角/空格归一化）；
- `WecomIdsTest`：版本映射与未知版本拒绝；
- `ScheduleTest`：下一次触发时间的跨天计算；
- `AiParsingTest`：URL 拼接、模型列表、两种协议的响应解析、错误信息、一句话解析成正文+范围。
- `BroadcastSafetyTest` / `RecipientSnapshotTest`：部分失败不能批准发送、运行互斥与取消、多屏重名与不完整名单拒绝、续跑只碰剩余会话、范围与分类页映射；
- `ScheduleStoreTest`：并发写入、原子保存、到点去重、暂停/删除不被运行结果覆盖；
- `BroadcastServiceTest`：Android 8 不检查尚不存在的前台服务权限，Android 9/14 分别检查对应权限；
- `AiClientTest` / `RunStoreTest`：重定向不转发凭据、同毫秒运行记录的唯一标识；
- `WecomLayoutTest`：按结构定位列表 / 输入框 / 标题 / 行标题 / 头像，候选不唯一时返回空；
- `AssistantProtocolTest`：助手动作解析、危险操作拦截、屏幕清单不泄露密码框。

历史真机白盒验证（vivo X21 / Android 9 / 企微 5.0.12；本次审查修复后的版本仍需重跑）：

| 场景 | 结果 |
|---|---|
| 读屏 | 首页 76 控件、群聊列表 43、会话页 27；输入框 `iu5`、正文 `ith`、头像 `j3b` |
| 试运行 | 连续 2 次通过：冻结名单 → 进入会话 → 核对标题 → 写入 → 回读 → 清理草稿，未发送 |
| 正式发送 | 只点一次，回读输入框清空并出现新的右侧头像气泡；会话内只有一条新消息 |
| 定时 | 23:22 到点自动执行并发送成功，随后推进到次日 |
| AI | 本地网关：获取到 11 个模型；保存并测试返回「可用」；「AI 生成」成功写入消息 |

## 规则（沿用旧栈的安全不变量）

- 范围只有三种：群聊分类、单聊（「全部」里按完整名称排除群会话）、全部会话；
- 名单先冻结，读不全 / 重名 / 标题带省略号即停；
- 会话已有草稿、草稿回读不一致、发送按钮不唯一即停；
- 发送只点一次，结果不明不重发；
- 已知版本用资源 ID 精确命中；未收录版本按界面结构定位（列表=最大的可滚动区、输入框=唯一可编辑控件、标题=顶部文字、行标题=行内第一个非数字文字），分不清就停。

## 已知限制

- 只支持前台无障碍：锁屏或切走会停止/跳过；不建虚拟屏、不需要无线调试。
- 已收录 5.0.12 的 ID 映射；其它版本按结构定位，尚未在真机上验证过。
- 定时任务在锁屏时跳过并在日志里记录，不尝试解锁。
- 多屏名单必须能读取稳定的列表位置和完整顺序；无法确认开头/末尾、位置缺失或名单变化时停止，不发送部分名单。
- 手动和定时群发共用一个执行锁；忙时拒绝新任务，不排队重发。到点闹钟先推进到次日，任务中断也不补发。
- Android 后台启动被系统拒绝时记录跳过；需在设置页允许精确闹钟，不能把不精确闹钟当作准时执行保证。
- 界面文案目前只有简体中文。
- 发送成功只代表界面出现新消息，不代表对方已收到。

## 代码结构

```
app/src/main/java/com/por/auto/agent/
  a11y/       无障碍服务、节点归一化、JSON 编码、悬浮按钮
  capture/    通知触发、读屏落盘
  wecom/      企微树读取、结构定位、版本 ID 提示、点击/输入、群发、运行记录
  assistant/  通用助手：动作协议、安全拦截、读屏→模型→执行的循环
  schedule/   定时存储、AlarmManager、前台服务
  ai/         配置与加密存储、OpenAI/Anthropic 客户端、响应解析
  ui/         Compose：四个标签页、主题、通用组件
```
