# PorAuto Agent（Android APK）

企业微信自动化，单个 APK，装完即用。当前是客户交付主线。

## 界面

四个底部标签：

| 标签 | 作用 |
|---|---|
| 群发 | 选范围（群聊 / 单聊 / 全部）→ 填消息 → 试运行（只写草稿再清理）→ 正式发送（只点一次并回读）；中途失败可以只补发剩下的会话 |
| 定时 | 每天固定时间执行一次群发（范围自选）；暂停 / 立即运行 / 删除 |
| 日志 | 每次运行的时间、类型、成功失败数；展开看每个会话的结果 |
| 设置 | 无障碍状态、悬浮读屏按钮、通知按钮、精确闹钟、AI 配置、调试 JSON、版本 |

## App 图标

采用已确认的 B 方案：明黄背景、黑猫主体与纸飞机配饰。

- `branding/logo-master.png`：1024×1024 满版原稿，不含展示用灰底、圆角边框或外投影。
- `branding/logo-production-prompt.txt`：原稿整理提示词，不含接口凭据。
- `app/src/main/res/drawable-nodpi/ic_launcher_foreground.png`：432×432 自适应图标图层；原稿缩至 272×272 后四周各延展 80px，避免关键表情被裁掉或出现内嵌边框。
- `app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`：桌面图标与圆形图标共用；通知小图标仍保留独立的功能性图案。

## AI 配置

设置 → AI：

1. 选 `OpenAI 兼容` 或 `Anthropic 兼容`；
2. 填 Base URL（如 `https://api.deepseek.com/v1`）；
3. 填 API Key（Keystore 加密保存，留空表示不修改）；
4. 点「获取模型」，从列表里选一个；
5. 点「保存并测试」，通过后群发页就能用「AI 生成」：一句话同时填好消息正文和范围，仍需自己试运行确认。

留空复用 Key 仅限相同协议和 Base URL；变更接口时必须重新填写 Key。接口重定向不会自动跟随，避免凭据被带到其他地址。加密保存失败时保留原配置并显示错误。

只允许两种协议：OpenAI 的 `/chat/completions` + `/models`，Anthropic 的 `/messages` + `/models`。
Debug 包的明文 HTTP 只对 `127.0.0.1 / localhost / 10.0.2.2` 放行，接本地网关时可用 `adb reverse tcp:3425 tcp:3425`。Release 包只允许 HTTPS。

## 构建

```sh
cd android
ANDROID_HOME=$HOME/Library/Android/sdk ./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## 测试

单元测试（JVM，不依赖设备）：

- `WecomTitleTest`：标题比对（群成员数后缀、省略号、全角/空格归一化）；
- `WecomIdsTest`：版本映射与未知版本拒绝；
- `ScheduleTest`：下一次触发时间的跨天计算；
- `AiParsingTest`：URL 拼接、模型列表、两种协议的响应解析、错误信息、一句话解析成正文+范围。
- `BroadcastSafetyTest` / `RecipientSnapshotTest`：部分失败不能批准发送、运行互斥与取消、多屏重名与不完整名单拒绝、续跑只碰剩余会话、范围与分类页映射；
- `ScheduleStoreTest`：并发写入、原子保存、到点去重、暂停/删除不被运行结果覆盖；
- `BroadcastServiceTest`：Android 8 不检查尚不存在的前台服务权限，Android 9/14 分别检查对应权限；
- `AiClientTest` / `RunStoreTest`：重定向不转发凭据、同毫秒运行记录的唯一标识。

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
- 企业微信版本必须有 ID 映射，否则拒绝运行。

## 已知限制

- 只支持前台无障碍：锁屏或切走会停止/跳过；不建虚拟屏、不需要无线调试。
- 只支持企微 5.0.12；升级后要先补 `WecomIds`。
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
  wecom/      企微树读取、版本 ID 映射、点击/输入、群发、运行记录
  schedule/   定时存储、AlarmManager、前台服务
  ai/         配置与加密存储、OpenAI/Anthropic 客户端、响应解析
  ui/         Compose：四个标签页、主题、通用组件
```
