# 手机独立 Android 执行端：运行时约束核查

> 选型已按用户后续澄清调整：当前优先直接依赖官方 AutoJs6，由用户维护 JS 脚本，不先自建 Kotlin Agent。本文保留系统 API 与备选方案的事实核查；最终交付路线以 [PC + AutoJs6 方案](../outputs/desktop-and-autojs6-plan.md) 为准。

核查日期：2026-10-18（Asia/Shanghai）。范围：普通无 root 客户手机，Android 12–16，本地优先，手机独立执行与现有 PC 控制并存。只研究官方文档与上游源码，未运行手机任务、未读取密钥或用户数据。GitHub 日期为 API 返回的 UTC 日期；提交活跃度不等于真机兼容性。

**结论：新增自有 APK 的公开 API 路径成立，但需要用户开启无障碍服务；原生节点、手势、中文输入和截图都可实现。现有 u2.jar 的 shell 权限不能随代码一起搬进普通 APK。定时触发、解锁、应用启动、页面操作是不同环节，不能承诺秒级完成、锁屏无人值守或后台永活。** 主要证据见下文。

## 1. 无障碍执行：事实与边界

| 能力 | 已核实事实 | 设计边界 |
| --- | --- | --- |
| 读取跨应用节点 | 配置 `canRetrieveWindowContent`，通过事件 `source`、`rootInActiveWindow` 获取节点；`FLAG_RETRIEVE_INTERACTIVE_WINDOWS` 用于交互窗口，`FLAG_REPORT_VIEW_IDS` 用于资源 ID。[服务指南](https://developer.android.com/guide/topics/ui/accessibility/views/service)、[服务配置 API](https://developer.android.com/reference/android/accessibilityservice/AccessibilityServiceInfo) | 读取的是目标页面暴露的无障碍树；可能为空或过时。Android 14+ 的敏感节点可对非无障碍工具隐藏。[节点保护 API](https://developer.android.com/reference/androidx/core/view/accessibility/AccessibilityNodeInfoCompat#setAccessibilityDataSensitive(boolean)) |
| 点击、滑动、返回 | 节点 `performAction(ACTION_CLICK)`；手势 `dispatchGesture`（API 24，需 `canPerformGestures`）；返回/主页通过 `performGlobalAction`。[服务 API](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService) | 检查返回值、回调及实际页面变化；节点动作可能不被目标控件实现，坐标操作受布局和系统手势环境影响。 |
| 中文输入 | `ACTION_SET_TEXT`（API 21）接收 `ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE`；API 33 起无障碍输入连接有 `commitText(CharSequence, …)`，需 `FLAG_INPUT_METHOD_EDITOR`。[设置文本](https://developer.android.com/reference/android/view/accessibility/AccessibilityNodeInfo.AccessibilityAction#ACTION_SET_TEXT)、[输入连接](https://developer.android.com/reference/android/accessibilityservice/InputMethod.AccessibilityInputConnection)、[输入编辑器标志](https://developer.android.com/reference/android/accessibilityservice/AccessibilityServiceInfo#FLAG_INPUT_METHOD_EDITOR) | **推断：** Unicode 中文可直接作为文本传入，无需依赖 ADB 字母键码；成功仍取决于目标编辑控件及焦点。建议输入后回读校验。备用自有 IME 需要用户启用/选择，属于另一授权环节。[IME 指南](https://developer.android.com/develop/ui/views/touch-and-input/creating-input-method) |
| 原生截图 | `takeScreenshot`（API 30）需 `canTakeScreenshot`；`takeScreenshotOfWindow`（API 34）可避开无障碍浮层遮挡。高频请求、服务权限丢失、安全窗口等有明确失败状态。[截图 API](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService#takeScreenshot(int,%20java.util.concurrent.Executor,%20android.accessibilityservice.AccessibilityService.TakeScreenshotCallback)) | 建议 Android 12–16 的步骤截图先采用此路径；连续投屏是另一需求。若使用 MediaProjection，每次投影会话均需用户同意，不能永久复用授权 token。[投影指南](https://developer.android.com/media/grow/media-projection) |

**授权事实：** 无障碍服务由系统绑定，普通应用不能静默自启授权；用户须在系统设置主动打开。Manifest 用 `BIND_ACCESSIBILITY_SERVICE` 保护绑定入口。它的生命周期与普通 `startForegroundService()` 启动型服务不同，不应把所有前台服务限制直接等同于无障碍服务限制。[生命周期与声明](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService#ServiceLifecycle)

Android 13+ 的部分安装来源会遇到“受限设置”，用户可能还需在应用信息里手动允许后才能开启无障碍。[Android 官方帮助](https://support.google.com/android/answer/12623953)

**锁屏事实：** `isDeviceLocked()` 表示访问应用需要认证；`requestDismissKeyguard()` 对安全锁屏会显示用户凭据界面，仅非安全锁屏或可信状态可直接解除。唤醒 CPU、点亮屏幕、解除安全锁屏不能混为一谈。[KeyguardManager](https://developer.android.com/reference/android/app/KeyguardManager#requestDismissKeyguard(android.app.Activity,%20android.app.KeyguardManager.KeyguardDismissCallback))

**建议：** 锁屏、无障碍断开、节点不可见时进入“等待用户处理/跳过本次”，不尝试绕过凭据。自定义绘制、敏感区域和具体微信版本均按客户手机实测；不要为了读取受保护节点冒充 `isAccessibilityTool`。[Android 官方安全说明](https://developer.android.com/blog/posts/enhancing-android-security-stop-malware-from-snooping-on-your-app-data)

## 2. 本地定时：Android 12–16 的明确限制

下表区分“设备运行版本”与“应用 targetSdk”。这些规则也适用于为 APK 另建的任务/连接服务；增加一个常驻通知不会自动解除限制。

| 版本 | 与本项目相关的事实 |
| --- | --- |
| Android 12 / API 31 | target 31+ 通常不能从后台启动前台服务；用户操作、用户请求的精确闹钟等属于明确例外，普通后台定时器不自动获得例外。[后台启动限制](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start) |
| Android 13 / API 33 | 用户可在系统“活动应用”中停止含前台服务的整个应用；这与设置中的强行停止不是同一动作，官方说明该按钮停止后已安排的 alarms/jobs 仍可执行。[用户停止行为](https://developer.android.com/develop/background-work/services/fgs/handle-user-stopping) |
| Android 14 / API 34 | target 34+ 的前台服务须声明匹配类型及权限。设备 Android 14+、新装且 target 33+ 的大多数应用，`SCHEDULE_EXACT_ALARM` 默认不授予。[声明要求](https://developer.android.com/develop/background-work/services/fgs/declare)、[精确闹钟默认拒绝](https://developer.android.com/about/versions/14/changes/schedule-exact-alarms) |
| Android 15 / API 35 | target 35+ 的 `dataSync`、`mediaProcessing` 后台前台服务各共享每 24 小时 6 小时额度；不是所有前台服务一律 6 小时。部分类型不能由开机广播启动，悬浮窗后台启动例外还要求浮窗实际可见。[超时规则](https://developer.android.com/develop/background-work/services/fgs/timeout)、[版本变化](https://developer.android.com/develop/background-work/services/fgs/changes) |
| Android 16 / API 36 | 在 Android 16 上，无论 targetSdk，前台服务中发起的后台 jobs（包括 WorkManager）也受对应运行额度约束；前台服务不能给 WorkManager 无限配额。[版本变化](https://developer.android.com/develop/background-work/services/fgs/changes) |

**调度 API 的事实：**

- 精确闹钟用于确实需要准时的用户可见功能。`SCHEDULE_EXACT_ALARM` 需用户授权并用 `canScheduleExactAlarms()` 检查；撤销会取消未来精确闹钟。`USE_EXACT_ALARM` 的适用范围更窄，不能把自动化应用默认当闹钟/日历。重启后需要重建闹钟。[AlarmManager 指南](https://developer.android.com/develop/background-work/services/alarms)
- Doze 暂停网络、推迟标准闹钟及 jobs；包括普通 `setExact()`。`setExactAndAllowWhileIdle()` 可在 idle 触发，但官方说明每应用两次此类 idle 闹钟不能少于 9 分钟。普通 WorkManager 也受 Doze 影响。[Doze 文档](https://developer.android.com/training/monitoring-device-state/doze-standby)
- WorkManager 周期任务最小间隔为 15 分钟，实际运行受约束及系统优化影响，适合维护/可延后任务，不能用于秒级 Cron。[定义工作请求](https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started/define-work)

**建议：** 本地持久化任务和下一触发点；符合条件时用一次性 AlarmManager 安排下一轮，WorkManager 做恢复检查等可延后工作。开始前验证解锁、授权、前台页面与队列占用；记录“计划时间/实际开始/完成/延迟或跳过原因”。允许用户设置执行窗口、错过后的处理策略。前台服务类型按实际用途选择，必要时评估 `specialUse` 并说明用途，不能冒用 `dataSync` 保活。[服务类型](https://developer.android.com/develop/background-work/services/fgs/service-types#special-use)

**交付边界：** 精确闹钟可提高“触发”的准时性，不能保证随后启动目标应用、解锁、网络响应和整批 UI 操作秒级完成。厂商系统和客户机型未定，目前只能承诺可观测、可暂停和失败可解释；不能承诺后台永活或所有品牌同等表现。

## 3. 开源执行器：适配与准确许可

| 项目 | 本次维护快照 | 与自有 APK 的适配程度 |
| --- | --- | --- |
| [AutoJs6](https://github.com/SuperMonster003/AutoJs6) | 未归档；最新 Release [v6.7.0，2026-03-14](https://github.com/SuperMonster003/AutoJs6/releases/tag/v6.7.0)；默认分支 [2026-03-16，ed3eb10](https://github.com/SuperMonster003/AutoJs6/commit/ed3eb10e88db5a8425fd94bdddefa4176e5e1c94)。有 2026 年发布，近七个月默认分支未见更新，不宜笼统称持续高频维护。 | 无障碍 JS、选择器、截图、脚本打包 APK、桌面辅助开发均有上游说明，手机独立形态接近需求；现有 JSON/Rust 工作流仍需适配。[README](https://github.com/SuperMonster003/AutoJs6/blob/ed3eb10e88db5a8425fd94bdddefa4176e5e1c94/README.md) |
| [GKD](https://github.com/gkd-kit/gkd) | 未归档；最新 Release [v1.12.1，2026-05-20](https://github.com/gkd-kit/gkd/releases/tag/v1.12.1)；默认分支 [2026-10-16，5a3d485](https://github.com/gkd-kit/gkd/commit/5a3d485e6f9f85888cb17e29f91bc6f220288321)，近期仍更新。 | 核心是屏幕条件匹配、选择器、订阅规则与点击；默认不附规则。适合参考规则更新/页面快照，不能直接等同完整定时工作流、PC 队列与业务结果确认引擎。[README](https://github.com/gkd-kit/gkd/blob/5a3d485e6f9f85888cb17e29f91bc6f220288321/README.md) |

**AutoJs6 许可事实：** 根 [LICENSE 为 MPL-2.0](https://github.com/SuperMonster003/AutoJs6/blob/ed3eb10e88db5a8425fd94bdddefa4176e5e1c94/LICENSE)。按其 3.1–3.4 条，分发需提供受覆盖文件及修改的源码、保留声明；独立文件构成 larger work 可另行许可。它不是“整个 APK 无条件全闭源”，也不意味着不能做自有品牌；品牌/商标权没有随 MPL 授出。集成前需按所用模块检查第三方许可。

**AutoJs6 新系统边界：** [version.properties](https://github.com/SuperMonster003/AutoJs6/blob/ed3eb10e88db5a8425fd94bdddefa4176e5e1c94/version.properties) 中主程序 min 24、compile/target 36，但打包运行器 `TARGET_SDK_VERSION_INRT=29`。编译到 API 36 不证明打包 APK、定时、截屏与各厂商系统都已验收。

**GKD 许可事实：** README 指明 **GPL-3.0-only**，根 [LICENSE 是标准 GPLv3](https://github.com/gkd-kit/gkd/blob/5a3d485e6f9f85888cb17e29f91bc6f220288321/LICENSE)。GPL 允许收费分发，并要求遵守对应源码/衍生作品许可义务；不能当闭源白牌底座。同时 README 另写“禁止用于商业或非法用途”，与标准 GPL 的商业使用许可存在表述冲突。**建议：** 商业复用前先澄清该附加声明或取得明确授权；不要把 GPL 一概解释成禁止商业用途。

**建议：** 自有品牌、现有 PC 产品和有限动作集优先考虑自建小型 Kotlin/Compose Agent；AutoJs6 可作为原型或经过许可审查的备选。GKD 主要借鉴公开设计思路，不能因采用类似选择器就忽略代码与订阅内容各自许可。此为架构取舍，不是对两者已完成真机对比测试的结论。

## 4. uiautomator2：不能由普通 APK 自动获得 shell 身份

**当前仓库事实：** [src-tauri/src/u2.rs](../src-tauri/src/u2.rs) 固定 `android-uiautomator-server-jar` 0.4.0，通过 ADB push 到 `/data/local/tmp`，再由 `adb shell` 执行 `CLASSPATH=… app_process / com.wetest.uia2.Main -p 9010`。上游 [jar 启动说明](https://github.com/openatx/android-uiautomator-server-jar#launch-jar-server) 和 [Python 客户端 core.py](https://github.com/openatx/uiautomator2/blob/master/uiautomator2/core.py) 同样使用 shell 路径。旧版 [APK server](https://github.com/openatx/android-uiautomator-server#build) 则由 `adb shell am instrument` 启动测试；安装 APK 与获得执行权限是两件事。

**权限证据：** jar 的 [InstrumentShellWrapper](https://github.com/openatx/android-uiautomator-server-jar/blob/d0449b9da4b32ad28bee0d3c3f561c49010acf35/uicore/src/main/java/uiautomator/InstrumentShellWrapper.java) 构建 `UiAutomationConnection`。Android 16 AOSP 的 [AccessibilityManagerService](https://android.googlesource.com/platform/frameworks/base/+/android16-release/services/accessibility/java/com/android/server/accessibility/AccessibilityManagerService.java#1626) 在 `registerUiTestAutomationService` 强制检查 `RETRIEVE_WINDOW_CONTENT`；[系统 Manifest](https://android.googlesource.com/platform/frameworks/base/+/android16-release/core/res/AndroidManifest.xml#4862) 将其定为 `signature|privileged`，而 [Shell Manifest](https://android.googlesource.com/platform/frameworks/base/+/android16-release/packages/Shell/AndroidManifest.xml#177) 声明了此权限。

**据此推断：** 普通无 root APK 仅打包 jar、调用其入口或 `Runtime.exec("app_process …")`，仍是应用自身 UID，不会变成 adb shell；手动开启无障碍也不会授予该签名权限。不能把“无 root 的 ADB 可运行”理解成“无 ADB 的普通 APK 可直接运行”。

| 路径 | 前置条件与定位 |
| --- | --- |
| 普通 APK + AccessibilityService | 用户手动授权；使用上文公开 API，自有手机执行端的默认候选。 |
| ADB shell / instrumentation | 用户开调试并授权电脑；保留当前成熟接入形态，但当前仓库实现依赖 PC。 |
| Shizuku | 应用需集成其 API并获用户授权；`UserService` 可在 shell UID 2000 或 root UID 0 下运行代码。无 root 时 Android 11+ 可手机无线调试启动，每次重启后需重新启动；较旧系统需电脑。因此是可选增强，不等于免配置普通 APK。[开发文档](https://github.com/RikkaApps/Shizuku-API#userservice)、[启动指南](https://shizuku.rikka.app/guide/setup/) |
| root | 需设备已有 root 和授权；可提供特权进程，客户手机未定时不作为默认交付前提。Shizuku 的 shell 与 root 权限范围不同。[权限区别](https://github.com/RikkaApps/Shizuku-API#differents-of-the-privilege-betweent-adb-and-root) |

Shizuku 运行 u2 仍需做进程、隐藏 API、端口与系统版本适配；本次仅证实特权代码路径存在，未验证一个即插即用的 u2 + Shizuku 成品。jar 仓库的根许可为 [MIT](https://github.com/openatx/android-uiautomator-server-jar/blob/d0449b9da4b32ad28bee0d3c3f561c49010acf35/LICENSE)，许可宽松不会解除 Android 权限限制。

## 5. 对当前产品的建议与尚待验证项

1. **保留 PC 的 Tauri/Vue。** 新增 Kotlin/Compose 手机 Agent：本地 UI 操作与 PC 下发都进入手机同一持久化串行队列，明确任务 ID、工作流快照与执行所有权，防止两个端同时点同一屏幕。当前 ADB/u2 作为过渡能力，切换执行器需互斥。
2. **先做有限动作协议。** 共享工作流格式与结果语义，分别实现无障碍和 u2 适配器；不要宣称底层 JSON-RPC、XML 与节点生命周期完全一致。采用本地配对的 USB/LAN 通道可满足暂无后端的约束，远程跨网另行评估。
3. **以目标真机验收。** 覆盖客户系统/品牌、中文输入后回读、点击结果、截图失败、锁屏/解锁、授权撤销、Doze 延迟、系统停止与重启恢复；另测 PC 与手机同时提交时串行且不重复。当前没有机型，不能形成兼容保证。

以上三项均为研究后的架构建议，未实现。

## 6. PC 安装 APK 与手机自更新

**PC 安装事实：** 已授权 USB 调试的手机可由桌面客户端下载 APK 后执行 `adb -s <serial> install -r <apk>`。官方说明 `-r` 重装现有应用并保留数据；成功仍以系统返回为准，设备策略或厂商确认不能预先排除。此路径不等同于手机普通应用取得静默安装权限。[ADB 官方命令](https://developer.android.com/tools/adb#pm)

**手机安装事实：** `PackageInstaller.Session` 可写入 APK 并提交安装/升级；需要用户操作时会返回 `STATUS_PENDING_USER_ACTION`，应用应呈现返回的系统 Intent，后台场景用通知引导用户返回。普通客户手机的交付流程应支持系统确认，不应承诺全部免确认。[PackageInstaller](https://developer.android.com/reference/android/content/pm/PackageInstaller#STATUS_PENDING_USER_ACTION)

Android 8.0+ 的“允许安装未知应用”按来源应用授权。自更新 APK 需声明 `REQUEST_INSTALL_PACKAGES` 并检查 `canRequestPackageInstalls()`；通过浏览器初装时给浏览器的授权，不等于自动给 Agent 授权。ADB 初装成功也不能推导出手机自更新来源已获准。[未知来源安装](https://developer.android.com/distribute/marketing-tools/alternative-distribution#unknown-sources)、[权限检查 API](https://developer.android.com/reference/android/content/pm/PackageManager#canRequestPackageInstalls())

**有条件免确认，不能一概否认：** API 31+ 的 `setRequireUserAction(USER_ACTION_NOT_REQUIRED)` 支持符合条件的更新。对于使用 `REQUEST_INSTALL_PACKAGES` 的安装器，官方列出的条件须全部满足：设置该模式；安装器为合适的 update owner / installer of record，或者正在更新自己；声明 `UPDATE_PACKAGES_WITHOUT_USER_ACTION`；被安装版本的 targetSdk 达到系统门槛（Android 12→29、13→30、14→31、15→33、16→34）。默认未指定时，使用请求安装权限的安装器按“需用户操作”处理；官方要求始终准备处理 `STATUS_PENDING_USER_ACTION`。[完整条件](https://developer.android.com/reference/android/content/pm/PackageInstaller.SessionParams#setRequireUserAction(int))

**升级身份与数据：** 正常原位升级保持同一包名及兼容的 APK 签名身份，通常继续使用同一发布签名密钥；提高 `versionCode`。不能把重新生成签名密钥、换包名或“先卸载再安装”当作保留本地任务数据的升级。签名轮换需合法的信任链及版本适配，不能只替换证书。原位保留数据也不能代替数据库迁移验证。[APK 签名与升级](https://developer.android.com/studio/publish/app-signing#considerations)、[版本号](https://developer.android.com/studio/publish/versioning)、[ADB 保留数据语义](https://developer.android.com/tools/adb#pm)

**签名机制：** APK Signature Scheme v2 自 Android 7.0 提供整包完整性保护；v3 自 Android 9 引入签名轮换证明。Android 12–16 发布 APK 应通过标准 Android 工具签名并验证适用方案。Tauri 桌面更新的外部签名不是 APK 安装签名，不能替代它；Tauri Updater 官方接入示例本身使用 `cfg(desktop)` 和桌面平台依赖。[v2](https://source.android.com/docs/security/features/apksigning/v2)、[v3](https://source.android.com/docs/security/features/apksigning/v3)、[Tauri Updater](https://v2.tauri.app/plugin/updater/)

**建议：** PC 与 Agent 共用可信 APK 发布源及版本元数据，分别实现“桌面下载后 ADB 安装”和“手机检查→下载→校验包名/版本/签名→PackageInstaller 安装”。手机可自动检查、按设置下载；安装根据系统条件进入免确认或用户确认分支，保留取消和失败状态。利用静态 HTTPS/GitHub Release 可继续无需业务后端。检查更新属于可延后的后台工作，不承诺固定秒点；安装前等待手机任务队列空闲，升级后核对本地任务、权限和服务状态。上述为建议，本次没有实现自动更新。

本次仅新增本报告；未构建 APK、修改应用代码、发布或提交。
