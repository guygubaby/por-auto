# Android 微信 UI 自动化开源底层核查

核查日期：2026-10-15（Asia/Shanghai）。GitHub 星数为本次 API 读取快照，会变化。发布日期、提交日期按 GitHub 返回的 UTC 时间取日期；最新提交指默认分支 HEAD，`pushed_at` 不等于最后一次业务代码修改时间。

## 结论

1. **电脑控制模拟器/真机，优先 `openatx/uiautomator2`**：本次三个通用底层中星数最高，MIT，控件选择器、XPath、中文文本输入所需的剪贴板/辅助输入法路径、截图和 UI XML 导出都有明确源码或文档。它提供操作能力，微信的源群定位、消息筛选、原消息转发、群名确认、任务去重和结果核验仍需自己实现。[U1][U2]
2. **手机脱离电脑独立运行，优先 `SuperMonster003/AutoJs6`**：Android 内运行 JavaScript，含每日/每周/一次性任务，已有 ARM、x86、x86_64 APK。与“触动精灵”使用形态最接近。[A1][A2][A4]
3. **`aiselp/AutoX` 保留为备选**：近期更新更活跃，Node.js/TypeScript 等能力较新；官方当前发布 APK 只有 ARM64，且许可证文件与 README 存在附加非商业条款及多个许可证的声明，不适合不经澄清就直接作为收费交付的默认底座。[X1][X2][X3]

**本轮未找到可以据此承诺“当前个人微信版本、任意源群消息类型、任意目标群列表、定时无人值守”均已成熟支持的通用开源成品。** 已找到的是通用自动化引擎、旧微信脚本、Android 演示工程及企业微信历史开源工程。这个结论仅限本轮检索和核查范围，不能据此宣称 GitHub 上绝对不存在其他项目。

## 1. 通用底层的维护快照

| 项目 | Stars | 最新 GitHub Release | 默认分支最新提交 | 许可 / 发行说明 |
| --- | ---: | --- | --- | --- |
| [openatx/uiautomator2](https://github.com/openatx/uiautomator2) | 8,422 | 3.7.0，2026-06-26 | 2026-10-05，`6de6d4c` | MIT；未归档。[U1][U2][U3] |
| [SuperMonster003/AutoJs6](https://github.com/SuperMonster003/AutoJs6) | 6,475 | v6.7.0，2026-03-14 | 2026-03-16，`ed3eb10` | MPL-2.0；未归档。[A1][A2][A3] |
| [aiselp/AutoX](https://github.com/aiselp/AutoX) | 1,912 | v7.2.4，2026-10-03 | 2026-10-09，`54d2638` | GitHub API 为 `NOASSERTION`；README 要求 MPL-2.0+非商业性使用及 GPL-V2；`LICENSE.md` 明示附加非商业条款，另有 `LICENSE-GPL-V2.md`。未归档。[X1][X2][X3] |

最新提交不能直接代表引擎功能在当天被更新。例如 uiautomator2 本次 HEAD 是 README 插件列表更新，应分别看发布版本与功能源码。

### 可复用的技术能力

| 能力 | uiautomator2 | AutoJs6 | AutoX v7 |
| --- | --- | --- | --- |
| 执行形态 | 电脑 Python 驱动 Android 设备；ADB 连接和设备端服务 | Android 内运行 JS，可打包 APK；电脑可辅助开发 | Android 内运行 JS；新增 Node.js 引擎和 TS 支持 |
| 控件定位 | `text/resourceId/className/description`、层级选择器、XPath | 无障碍选择器、节点遍历、布局分析 | 无障碍选择器、节点遍历、布局分析 |
| 文本 / 中文输入 | `set_text`、`send_keys`；文档说明 `send_keys` 优先剪贴板，失败尝试辅助 IME。目标微信输入框仍需实测 | `setText`；`setClip/getClip`，源码对 Android 10+ 的剪贴板读取有悬浮窗回退路径 | 选择器/输入能力；v6 API 兼容层明确导出 `setClip/getClip`。v7 新 API 与兼容 API 应区分 |
| 截图 / 结构 | `screenshot()`、`dump_hierarchy()` 输出 UI XML | 截屏、图片匹配/OCR插件、布局分析；可读取根节点/节点树，不应直接照搬 u2 的 XML API 名称 | 截屏、图片匹配、布局分析；并非 u2 同名 XML 接口 |
| 定时 | 此库核心提供设备操作；业务定时和任务持久化放主机调度层 | `tasks.addDailyTask/addWeeklyTask/addDisposableTask`；设置可选 AlarmManager/WorkManager/JobScheduler | 有定时任务数据库、设置页、`TimedTaskScheduler`；源码可切 WorkManager/AlarmManager |
| CPU / 模拟器 | 设备端当前为 `u2.jar` 经 `app_process` 运行，没有本次 AutoJs APK 那种 ARM/x86 资产选择；不能仅据此保证所有模拟器和辅助 IME 兼容 | 最新 Release 明确含 `arm64-v8a`、`armeabi`、`armeabi-v7a`、`x86`、`x86_64` 和 universal APK | 最新 Release/README 仅 `arm64-v8a` 与 mini ARM64，未提供原生 x86/x86_64 APK |

能力来源：[U1][U4][A1][A2][A4][A5][A6][X1][X2][X4][X5]。定时任务 API 的存在不证明锁屏、进程被清理、系统休眠后仍能准时完成整批 UI 操作；这是设备验证项。

**u2 架构更正：** 不应依据旧文章写成“必须依赖 atx-agent”。当前 `core.py` 的 `BasicUiautomatorServer` 注释明确 `runs without atx-agent`，启动命令为 `CLASSPATH=/data/local/tmp/u2.jar app_process / com.wetest.uia2.Main ...`。[U4]

## 2. 三个微信相关 Android 项目的核查

### 2.1 `Runzelee/WechatAutoMsg`：旧版 Auto.js 单目标发送脚本

- **快照**：13 Stars，最新默认分支提交 2022-06-02（`bbd41a6`），没有 GitHub Release，WTFPL。[R1][R2]
- **实际实现**：`main.js` 定义一个 `NAME` 和一个 `MSG`，在主页列表通过旧资源 ID `hje`、文本与滑动查找目标，使用 `className("EditText").findOne().setText(msg)` 输入，再点击“发送”。这并不是从源群自动识别消息再分发到一组群的实现。[R3]
- **搜索/群名**：作者将函数命名为查找目标，不代表已实现微信全局搜索或稳定的群列表管理；核查代码主要是会话列表查找与滑动。
- **消息类型**：仅输入常量文本；URL 可以作为文本内容，但没有卡片解析、卡片完整转发、小程序转发功能证据。
- **定时/兼容**：README 要用户自行设置 Auto.js 定时，作者称最佳为 Auto.js 4.0.1 Alpha，并报告 4.0.4/4.1.1/当时 AutoX 的 activity 或定时问题。这是 2022 年的项目记录，不能外推到当前 AutoJs6/AutoX 的实际兼容性。[R2]
- **可取之处**：小流程参考；不宜直接作为当前客户项目代码模板。

### 2.2 `AbbottKilig/wechat-rpa-demo`：较新的 Android Kotlin 演示工程

- **快照**：1 Star，最新默认分支提交 2026-02-27（`d1d23a8`），没有 GitHub Release。README 声明 Apache-2.0，但 GitHub API `license=null`，本次递归文件树未看到独立顶层 LICENSE 文件；应区分“作者在 README 声明”与“API 已识别许可证”。[D1][D2]
- **技术栈以当前源码为准**：仓库描述仍写 uiautomator2；当前 README 和 Kotlin 源码已改成 Android `AccessibilityService` + 内嵌 HTTP + Python 管理端。不能按搜索结果中的旧描述归类。[D2][D3]
- **群名查找**：`WeworkOperator.openChat(contactName, target)` 尝试回首页、点击“搜索”、输入名字，再用 `scrollAndFindText(contactName)` 打开搜索结果；`WECHAT` 分支优先文案和第一个输入框。它的参数允许联系人/群名，但没有稳定不可变群 ID、同名群判别或目标身份二次验证。[D3]
- **文本发送**：`sendMessage()` 有个人微信 `WECHAT` 分支，采用输入框 + 文案/描述“发送”；点击后等待固定时长就返回成功，未看到可靠的消息回读验证，更不是服务端送达凭证。[D3]
- **消息读取**：`readMessages()` 先找企业微信消息资源 ID，失败后扫描当前页面的 `TextView` 并排除少量文案。这个回退可能把页面上的其他文本也当成消息；没有完整消息主键、时间边界、发件人绑定、稳定类型化解析。[D3]
- **卡片/转发**：本次核查 `WeworkOperator.kt`、README API 列表未发现原消息转发、网页卡片 URL 提取或小程序卡片转发实现；不能从“支持读写消息”推导出这些能力。
- **作者主张边界**：README 的“99%+兼容”“高稳定性”等是作者主张；没有随项目给出可支持本需求的设备矩阵和长期运行实测。其用 atx-agent 批评 u2 的对比也没有反映当前 u2.jar 架构。[D2][U4]
- **可取之处**：可参考 Android 设备端服务、串行队列、UI dump 的组织方式；微信适配和执行结果确认需要补全。

### 2.3 `gallonyin/worktool`：有转发流程，但公开源码以企业微信为目标

- **快照**：2,727 Stars，最新 GitHub Release 2.8.0（2023-10-18），默认分支最新提交 2026-09-17（`2105e6d`），Apache-2.0，未归档。[W1][W2][W3]
- **开源版/当前商业版必须分开**：当前 README 第一段明确“GitHub 仓库提供的是开源历史版本”；持续维护并适配新版的是商业版。2026 年 README/下载链接更新，不等于公开源码已适配 2026 年个人微信。[W2]
- **个人微信/企业微信必须分开**：虽然当前 README 描述中出现“企微/微信”，公开 `Constant.kt` 的 `PACKAGE_NAMES` 是 `com.tencent.wework`，`accessibility_service_config.xml` 的 `packageNames` 也只有 `com.tencent.wework`。不能将它当作个人微信 `com.tencent.mm` 的现成开源成品。[W4][W5]
- **转发能力确有源码**：`WeworkOperationImpl.kt` 包含 `relayMessage()`、`relayMultiMessage()`、`relayMergeMessage()`、`pushLink()`、`pushMicroprogram()`。`relayMessage` 接收房间名列表、原内容和类型，并调用“转发”菜单和目标选择流程；`pushLink/pushMicroprogram` 调用的是 `IWWAPIUtil` 企业微信分享路径。[W6]
- **价值**：原消息转发、消息类型分支、目标选择、结果回传的设计参考。由于公开代码针对企微历史版本，本需求的个人微信 UI 适配仍需独立编写和验证。

## 3. 不能混为 Android UI 自动化的热门项目

| 项目 | 本轮快照 | 一手证据 / 区分 |
| --- | --- | --- |
| [cluic/wxauto](https://github.com/cluic/wxauto) | 7,361 Stars；最新默认分支提交 2026-04-13；Apache-2.0 | README 环境是 Windows 10/11/Server2016+、PC 微信 3.9.x、Python 3.9+。是 Windows 微信 UI 自动化，不是 Android 模拟器内的操作底层。[P1][P2] |
| [lich0821/WeChatFerry](https://github.com/lich0821/WeChatFerry) | 6,806 Stars；已归档；最新 Release v39.5.2，2026-03-28；默认分支最新提交 2026-03-21；MIT | 仓库描述明确 Hook；README 是 VS2019、Windows x64 工具链、`sdk.dll`。虽列“转发消息”，不能当 Android 无障碍/UI 自动化方案。[F1][F2][F3] |

## 4. 这次需求仍需自行实现的适配层

| 客户话术 | 开源底层已提供 | 仍需在目标微信版本确认/实现 |
| --- | --- | --- |
| “复制这个链接” | 节点文本读取、长按、菜单点击、剪贴板读取 | 纯 URL 文本可读性；链接卡片是否能复制真实 URL；指定发件人/指定时间窗口/最新一条的筛选；去重 |
| “原样转发” | 节点长按和原生菜单操作 | 找准源消息容器，打开原生“转发”，保留网页/小程序卡片；不同类型不能统一当作复制 URL |
| “发到其他所有群” | 搜索框输入、结果点击、返回/翻页 | 客户维护目标白名单、同名群识别、群名变更、无结果时停止；每次发送前确认当前群身份 |
| “定时定点” | AutoJs6/AutoX 定时任务；u2 可由主机定时触发 | 哪个时刻开始执行、允许多大的完成窗口、设备独占队列、休眠/锁屏恢复、故障暂停及断点状态 |
| “全部发送成功” | 点击和 UI 截图、节点回读 | 每目标持久化状态、发送前后截图/消息回读、结果不确定时人工复核；UI 回读不等于服务端或对端送达确认 |

这一层是交付工作量主体，选择通用引擎不会自动完成它。文本 URL、网页卡片、小程序卡片应分开验收。规模不能只按群数断言“必须多账号/多设备”；应先测单群切换和发送时长，再与允许的完成时间窗口比较。

## 5. 检索范围与验证边界

本轮使用 GitHub 仓库 API、默认分支完整文件树、Release API、README、许可证及关键源码；检索关键词包括 `wechat uiautomator2`、`wechat android automation`、`autojs wechat`、`微信 群发 android`、`微信 自动转发 android`、`微信 群发 auto.js` 等，按 Stars 查候选。部分后续 GitHub 搜索触发搜索接口限流，但已知候选仓库的一手源码可继续读取。不是对所有代码、所有同义词、Gitee、商业产品的穷尽审计。

Context7 本轮返回月度配额已用尽，未用其结果支持任何事实，改用项目一手源码。用户指定的 `/Users/bryceloskie/.codex/RTK.md` 不存在，无法读取。

未安装 APK、未构建工程、未连接模拟器/真机、未登录或操作微信、未触发消息发送。因此，这份文档证明项目的公开能力和代码边界，不证明指定微信版本的运行稳定性。没有测试或推定任何固定的发送频率、群数或账号数量阈值。

## 一手来源

### uiautomator2

- [U1] [仓库 README（锁定本次 HEAD）](https://github.com/openatx/uiautomator2/blob/6de6d4ce6e944998544e3f71aab5dbb31bd663f8/README.md)：架构、Selector、XPath、Clipboard、截图、dump_hierarchy、send_keys/辅助 IME、MIT。
- [U2] [GitHub 仓库元数据 API](https://api.github.com/repos/openatx/uiautomator2)：星数、license、archived；[最新提交](https://github.com/openatx/uiautomator2/commit/6de6d4ce6e944998544e3f71aab5dbb31bd663f8)。
- [U3] [3.7.0 Release](https://github.com/openatx/uiautomator2/releases/tag/3.7.0)。
- [U4] [core.py](https://github.com/openatx/uiautomator2/blob/6de6d4ce6e944998544e3f71aab5dbb31bd663f8/uiautomator2/core.py)：`u2.jar`、`app_process`、without atx-agent。

### AutoJs6

- [A1] [README](https://github.com/SuperMonster003/AutoJs6/blob/ed3eb10e88db5a8425fd94bdddefa4176e5e1c94/README.md)：无障碍、选择器、截图、OCR、打包、定时引擎设置。
- [A2] [v6.7.0 Release](https://github.com/SuperMonster003/AutoJs6/releases/tag/v6.7.0)：发布日期及全部 APK ABI 资产。
- [A3] [仓库元数据 API](https://api.github.com/repos/SuperMonster003/AutoJs6)、[LICENSE](https://github.com/SuperMonster003/AutoJs6/blob/ed3eb10e88db5a8425fd94bdddefa4176e5e1c94/LICENSE)、[最新提交](https://github.com/SuperMonster003/AutoJs6/commit/ed3eb10e88db5a8425fd94bdddefa4176e5e1c94)。
- [A4] [Tasks.kt](https://github.com/SuperMonster003/AutoJs6/blob/ed3eb10e88db5a8425fd94bdddefa4176e5e1c94/app/src/main/java/org/autojs/autojs/runtime/api/augment/tasks/Tasks.kt)：`addDailyTask/addWeeklyTask/addDisposableTask`。
- [A5] [Global.kt](https://github.com/SuperMonster003/AutoJs6/blob/ed3eb10e88db5a8425fd94bdddefa4176e5e1c94/app/src/main/java/org/autojs/autojs/runtime/api/augment/global/Global.kt)：`setClip/getClip` 与 Android 10+ 回退。
- [A6] [automator.html](https://github.com/SuperMonster003/AutoJs6/blob/ed3eb10e88db5a8425fd94bdddefa4176e5e1c94/app/src/main/assets-app/docs/automator.html)：`auto.root`、`auto.rootInActiveWindow`、`setText("测试")`。

### AutoX

- [X1] [README](https://github.com/aiselp/AutoX/blob/54d2638fec07c0bd79663e286e8e426a6e28511e/README.md)：许可声明、ARM64 APK、选择器/截图/布局分析、v7 引擎能力。
- [X2] [v7.2.4 Release](https://github.com/aiselp/AutoX/releases/tag/v7.2.4)、[元数据 API](https://api.github.com/repos/aiselp/AutoX)、[最新提交](https://github.com/aiselp/AutoX/commit/54d2638fec07c0bd79663e286e8e426a6e28511e)。
- [X3] [LICENSE.md](https://github.com/aiselp/AutoX/blob/54d2638fec07c0bd79663e286e8e426a6e28511e/LICENSE.md)、[LICENSE-GPL-V2.md](https://github.com/aiselp/AutoX/blob/54d2638fec07c0bd79663e286e8e426a6e28511e/LICENSE-GPL-V2.md)。
- [X4] [v6 兼容层 __globals__.js](https://github.com/aiselp/AutoX/blob/54d2638fec07c0bd79663e286e8e426a6e28511e/autojs/src/main/js/v6-api/src_raw/__globals__.js)：`setClip/getClip`。
- [X5] [TimedTaskScheduler.kt](https://github.com/aiselp/AutoX/blob/54d2638fec07c0bd79663e286e8e426a6e28511e/app/src/main/java/org/autojs/autojs/timing/TimedTaskScheduler.kt)：WorkManager/AlarmManager 调度实现。

### 微信相关 Android 项目

- [R1] [WechatAutoMsg 元数据](https://api.github.com/repos/Runzelee/WechatAutoMsg)、[最新提交](https://github.com/Runzelee/WechatAutoMsg/commit/bbd41a680aee8d1c842bfed43ea9593c58e8018b)、[LICENSE](https://github.com/Runzelee/WechatAutoMsg/blob/bbd41a680aee8d1c842bfed43ea9593c58e8018b/LICENSE)。
- [R2] [WechatAutoMsg README](https://github.com/Runzelee/WechatAutoMsg/blob/bbd41a680aee8d1c842bfed43ea9593c58e8018b/README.md)。
- [R3] [WechatAutoMsg main.js](https://github.com/Runzelee/WechatAutoMsg/blob/bbd41a680aee8d1c842bfed43ea9593c58e8018b/main.js)。
- [D1] [wechat-rpa-demo 元数据](https://api.github.com/repos/AbbottKilig/wechat-rpa-demo)、[最新提交](https://github.com/AbbottKilig/wechat-rpa-demo/commit/d1d23a8246e89fcd8bcb28ab466c85710a315225)、[完整文件树](https://api.github.com/repos/AbbottKilig/wechat-rpa-demo/git/trees/d1d23a8246e89fcd8bcb28ab466c85710a315225?recursive=1)。
- [D2] [wechat-rpa-demo README](https://github.com/AbbottKilig/wechat-rpa-demo/blob/d1d23a8246e89fcd8bcb28ab466c85710a315225/README.md)。
- [D3] [WeworkOperator.kt](https://github.com/AbbottKilig/wechat-rpa-demo/blob/d1d23a8246e89fcd8bcb28ab466c85710a315225/android-app/app/src/main/java/com/wechatrpa/service/WeworkOperator.kt)：`openChat/sendMessage/readMessages`。
- [W1] [WorkTool 元数据](https://api.github.com/repos/gallonyin/worktool)、[最新提交](https://github.com/gallonyin/worktool/commit/2105e6dde02c007f51f2e7cc51563187d227296f)。
- [W2] [WorkTool README](https://github.com/gallonyin/worktool/blob/2105e6dde02c007f51f2e7cc51563187d227296f/README.md)：历史开源版与维护中的商业版说明。
- [W3] [WorkTool 2.8.0 Release](https://github.com/gallonyin/worktool/releases/tag/2.8.0)。
- [W4] [Constant.kt](https://github.com/gallonyin/worktool/blob/2105e6dde02c007f51f2e7cc51563187d227296f/app/src/main/java/org/yameida/worktool/Constant.kt)：`PACKAGE_NAMES = "com.tencent.wework"`。
- [W5] [accessibility_service_config.xml](https://github.com/gallonyin/worktool/blob/2105e6dde02c007f51f2e7cc51563187d227296f/app/src/main/res/xml/accessibility_service_config.xml)：`packageNames="com.tencent.wework"`。
- [W6] [WeworkOperationImpl.kt](https://github.com/gallonyin/worktool/blob/2105e6dde02c007f51f2e7cc51563187d227296f/app/src/main/java/org/yameida/worktool/service/WeworkOperationImpl.kt)：原消息转发、批量/合并转发、链接和小程序分享。

### Windows / Hook 对照

- [P1] [wxauto 元数据](https://api.github.com/repos/cluic/wxauto)、[最新提交](https://github.com/cluic/wxauto/commit/05e5a52379c99f401dc512acfdd811b3d701da8b)。
- [P2] [wxauto README](https://github.com/cluic/wxauto/blob/05e5a52379c99f401dc512acfdd811b3d701da8b/README.md)。
- [F1] [WeChatFerry 元数据](https://api.github.com/repos/lich0821/WeChatFerry)：Hook 描述、归档状态、license 与星数。
- [F2] [WeChatFerry README.MD](https://github.com/lich0821/WeChatFerry/blob/0f5c60a034fcac234cabd000b49c9200defa7f7d/README.MD)：VS2019、Windows x64 工具链、DLL。
- [F3] [WeChatFerry v39.5.2 Release](https://github.com/lich0821/WeChatFerry/releases/tag/v39.5.2)、[最新提交](https://github.com/lich0821/WeChatFerry/commit/0f5c60a034fcac234cabd000b49c9200defa7f7d)。
