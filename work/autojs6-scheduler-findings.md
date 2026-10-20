# AutoJs6 6.7.0 手机持久调度核查

核查日期：2026-10-20。范围固定为官方 `v6.7.0` 源码、上游库源码和 Android 官方文档；本次未查询或操作手机、截图、调用模型、读取密钥或账号文件，也未构建任何产物。Context7 已解析到 `/supermonster003/autojs6`，查询因月额度耗尽失败，以下结论以固定版本源码为准。该版本随附的 [tasks 文档](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/assets-app/docs/tasks.html) 仍标为待完善，不能仅依赖文档目录推断 API。

## 本轮实施决策

下文的一次性宿主任务适合不依赖截图的工作流；本项目当前微信引擎必须读取截图，因此实际实现采用持续运行的商店会话，共用同一 ScriptRuntime 的截图授权、前台服务和唤醒锁。启动后检查本机保存的五段 Cron；停止、重启或锁屏后由用户重新开启，不自动申请截图、不补发。配置与代码固定为版本快照，运行前保存消费游标，忙碌与重叠跳过。Cron 使用纯 JS 字段解析与 Android java.time 的 ZoneRules 解析当地时间，不新增 DEX；与桌面共用时间用例检查 DST 缺口和第一次回拨时刻。实现及离线测试不代表已完成真机定时验收。

## 可选的宿主唤醒方案

**使用现有 AutoJs6 的 `tasks.addDisposableTask` 负责唤醒；自己的本地文件保存 Cron、IANA 时区、工作流/配置快照及消费游标。每次先消费本轮并安排新的下一轮，再执行无交互业务入口。** 不需要新增 APK，也不需要常驻 JS 循环。标准 Cron 解析不能假定宿主已内置；可预制并校验一个包含所需依赖的 cron-utils DEX，再由 `runtime.loadDex` 加载。

必须自行补齐三点：过期唤醒拦截、跨引擎互斥/幂等、宿主启动后的未来任务重建。AutoJs6 的“任务已触发”不等于“工作流成功”，宿主也不提供本项目要求的配置快照、恰好一次发送或不补跑策略。以下区分源码事实与实现建议。

## 1. 精确 API 与返回值

### 命名空间

v6.7.0 注册的是 **`tasks` / `$tasks`** 持久任务模块；`timers` / `$timers` 是 `setTimeout/setInterval/keepAlive` 等当前脚本计时器，后者不会自动变成数据库任务。不要照搬其他 Auto.js 分支的 `$timers.addDisposableTask` 示例。[运行时注册](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/runtime/ScriptRuntime.kt#L754)、[别名生成](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/runtime/api/augment/Augmentable.kt#L197)、[Timers](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/runtime/api/augment/timers/Timers.kt)

### JavaScript 调用签名

下表为从 [Tasks.kt](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/runtime/api/augment/tasks/Tasks.kt) 整理的 JS 可调用签名。`TimedTask` 和 `IntentTask` 是宿主 Java 对象，不是普通 JSON。

| 方法 | 参数与结果 |
| --- | --- |
| `tasks.addDisposableTask(options?)` | `{path, date?: number\|Date\|string, time?: 同date, delay?: number, interval?: number, loopTimes?: number, isAsync?/async?: boolean, callback?: function(task)}`；一次性任务。 |
| `tasks.addDailyTask(options?)` | 同上，但 `time`/`date` 表示每天的本地时刻。 |
| `tasks.addWeeklyTask(options?)` | 在 daily 参数上加 `daysOfWeek?: Array<number\|string>`，省略时默认当前星期。接受 `1..6` 为周一至周六，`0` 或 `7` 为周日；也接受 `Mon/Sun`、完整英文星期名及“一…日”，英文不区分大小写。 |
| `tasks.addIntentTask(options?)` | `{path, action?: string, dataType?: string, isLocal?/local?: boolean, isAsync?/async?: boolean, callback?: function(task)}`；事件任务，不是时间任务；没有 Cron 或时区参数。 |
| `tasks.addTask(task)` | 参数必须是 `TimedTask` 或 `IntentTask`；同步加入数据库，返回传入对象。普通对象不能代替该 Java 类型。 |
| `tasks.getTimedTask(id)` / `tasks.getIntentTask(id)` | 返回对应对象或 `null`；**没有通用 `getTask`**。 |
| `tasks.removeTimedTask(id)` / `tasks.removeIntentTask(id)` | 按 ID 删除，返回 boolean。 |
| `tasks.removeTask(task)` | 参数是任务对象，非 ID；`null` 返回 false。 |
| `tasks.updateTask(task)` | 参数是任务对象，写回并重排，返回 boolean；非普通 JSON patch。 |
| `tasks.queryTimedTasks(options?)` | `{path?: string}`，返回 JS 数组。 |
| `tasks.queryIntentTasks(options?)` | `{path?: string, action?: string}`，返回 JS 数组。 |

**add* 的返回值容易踩坑：** 无 callback、非 UI 线程、未设 async 时，返回任务对象；有 callback 时返回 callback 的返回值。`async/isAsync=true` **或调用处是 UI 线程**时，返回 `Thread`，任务对象通过 callback 接收。数据库插入发生在 `taskFulfilled` 前；async 不是“稍后才入库”的事务保证。应在 worker 注册并检查 `getId()/getTimedTask(id)`，不要在 UI 事件里把返回的 Thread 当任务 ID。[Tasks.kt 的 taskFulfilled](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/runtime/api/augment/tasks/Tasks.kt#L324)

`delay`、`interval` 单位为毫秒，`loopTimes` 默认 1；它们属于脚本执行重复配置，不是 Cron 规则。为避免自动重复发送，保持 `delay:0, interval:0, loopTimes:1`。`callback` 是添加任务后的回调，不是任务到点后的业务完成回调。

### 时间参数的实际含义

- 解析优先级为非空 `time`，否则 `date`，两者都空则用当前时间；因此一次性任务漏填日期会立即触发，保存计划前必须校验未来时点。
- Number 是 **Unix epoch 毫秒**；JS Date 先取 epoch 毫秒。daily/weekly 再经 Joda `LocalTime` 取宿主默认时区的时分秒，不是“今天零点后的毫秒”；例如 `9*60*60*1000` 不是可靠的“每天 09:00”。字符串 daily/weekly 可用 `09:00:00`，一次性用本地 ISO 日期时间如 `2026-10-21T09:00:00`，不要传 `YYYY/MM/DD` 等非该解析器格式。
- 一次性参数经 Joda `LocalDateTime` 转换，再用默认时区生成 epoch；daily/weekly 只保存一天内时刻和星期位图，**没有每任务 `timezone` 字段**。日期时间字符串不能替代 IANA 时区配置；显式业务时区应在自己的 Cron 计算层处理，再传计算出的 epoch。
- daily/weekly 的下一天搜索直接加 24 小时，不能据此保证 DST 缺口/回拨与桌面完全一致。一次性 epoch 在宿主默认时区发生回拨重叠时也经历“instant→无时区本地时间→instant”的转换；应核对 `task.getNextTime()` 等于原计划 epoch，不能无条件承诺任意时区精确保留。

源码：[parseLocalTime/parseLocalDateTime](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/runtime/api/augment/tasks/Tasks.kt#L289)、[TimedTask 的存储与 nextTime](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/timing/TimedTask.java)。Joda 官方说明：[LocalTime(long) 使用默认时区](https://www.joda.org/joda-time/apidocs/org/joda/time/LocalTime.html)、[LocalDateTime 无时区且 toDateTime 使用默认区](https://www.joda.org/joda-time/apidocs/org/joda/time/LocalDateTime.html)。

### 最小注册、查改删示例

以下只演示 API，**本次未运行，也不是完整调度实现**。`wake.js` 须已存在于稳定的本地目录，且是可顶层执行的 JS 入口。

```js
threads.start(function () {
  var path = String(context.getFilesDir().getCanonicalPath())
    + '/por-auto-mobile/scheduler/wake.js';
  var at = Date.now() + 60000;
  var task = tasks.addDisposableTask({
    path: path, date: at, delay: 0, interval: 0, loopTimes: 1
  });
  var id = Number(task.getId());
  if (id <= 0 || Number(task.getNextTime()) !== at)
    throw new Error('宿主任务注册或时间核对失败');
  var saved = tasks.getTimedTask(id);
  if (saved === null) throw new Error('任务没有保存在宿主数据库');

  // 仅示范未触发前修改计划；唤醒后的续约应新增 ID，见第 2 节。
  saved.setMillis(at + 60000);
  if (!tasks.updateTask(saved)) throw new Error('修改任务失败');
  if (!tasks.removeTimedTask(id)) throw new Error('删除任务失败');
});
```

daily/weekly 的同类调用：`tasks.addDailyTask({path: absolutePath, time:'09:00:00'})`；`tasks.addWeeklyTask({path: absolutePath, time:'09:00:00', daysOfWeek:[1,3,5]})`。不用于承载本项目通用 Cron，只用于了解宿主原生能力。

IntentTask 示例：`tasks.addIntentTask({path: absolutePath, action:'org.autojs.autojs.action.startup', isLocal:true})`。该 action 是 **AutoJs6 进程启动事件**，不是每次启动某个脚本或打开某个界面；`App.onCreate()` 重建订阅后发出。可作为只重建未来计划的恢复入口，不能把它做成立即补发业务的入口。[App.kt](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/App.kt#L123)、[DynamicBroadcastReceivers](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/external/receiver/DynamicBroadcastReceivers.kt)

### 脚本路径和事件参数

`path` 经 `files.nonNullPath` 按当前脚本运行目录解析；触发时 `ScriptIntents` 读取文件，以文件父目录为 workingDirectory，再设置执行参数 `intent`。不要绑定 downloads、临时解压或会被脚本更新删除的路径。[路径转换](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/rhino/extension/AnyExtensions.kt#L139)、[ScriptIntents](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/external/ScriptIntents.kt)

**私有目录可用的源码证据：** 定时任务走 `ScriptIntents → JavaScriptFileSource(path) → FileReader`，未限制路径必须在外部工作目录。`PathChecker` 对 Receiver/Application Context 检查非空及文件存在；其额外存储权限分支只针对 Activity Context。因此在**同一 AutoJs6 宿主**的 `context.getFilesDir()/por-auto-mobile/.../*.js` 保存稳定模块与每次触发小入口是可行路径，无须复制到公共脚本目录。IntentTask 使用 `ScriptFile.toSource()`，会按小写 `.js` 扩展选择 JavaScript；统一使用 `.js`，不要依赖 `.cjs` 被事件入口识别，也不要加 `"ui"` 模式头。[PathChecker](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/model/script/PathChecker.java)、[JavaScriptFileSource](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/script/JavaScriptFileSource.java)、[ScriptFile](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/model/script/ScriptFile.java)

**不会自动删除源脚本：** `notifyTaskFinished` 只删除一次性任务数据库行，`RunnableScriptExecution` 结束销毁引擎，没有删除源文件。宿主临时脚本清理针对 `cacheDir/tmp-scripts`，不针对上述自有 filesDir。每次触发生成的小入口须由自己按消费/取消/孤儿状态幂等清理，不能安排在宿主 tmp-scripts 里，也不能以任务 ID 从数据库消失就断言脚本已经读完而提前删除。[执行生命周期](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/execution/RunnableScriptExecution.java)、[宿主临时目录](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/storage/file/TmpScriptFiles.java)

唤醒脚本可通过 `engines.myEngine().execArgv.intent` 取得 Intent，用 `getLongExtra('task_id', -1)` 读宿主任务 ID；没有任意业务 `args` 字段可随 options 自动持久化。应以宿主 ID/唯一 scheduleId 找到自己的不可变快照，而不是把 JavaScript closure 当持久参数。[TimedTask.createIntent](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/timing/TimedTask.java#L202)、[execArgv 注入](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/runtime/api/augment/engines/Engines.kt#L47)

## 2. 跨进程、跨重启与宿主行为

| 已核实事实 | 对本项目的影响 |
| --- | --- |
| 时间任务存入 `TimedTaskDatabase.db`，事件任务存入 `IntentTaskDatabase.db`。App 启动和 BootCompletedReceiver 都会初始化任务调度。 | 不依赖启动器 UI 持续存活，可跨宿主进程/设备重启重建；清数据、卸载宿主不在保留范围内。[数据库](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/storage/database/TimedTaskDatabase.java)、[BootCompletedReceiver](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/timing/BootCompletedReceiver.kt) |
| 默认后端为 AlarmManager；使用 `setExactAndAllowWhileIdle(RTC_WAKEUP)`，异常会回退 WorkManager。 | 宿主登记成功不证明最终仍是精确闹钟路径；要显示授权/后端状态及实际延迟，不能承诺秒级准时。[默认值](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/res/values/strings.xml)、[Alarm 后端](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/timing/AlarmTimedTaskScheduler.kt) |
| 调度器只提前安排未来 2 天内的任务；20 分钟周期检查；Alarm 检查按下一时点排序，取前 450 个。 | 跨月低频任务依赖宿主周期检查后才真正进入系统闹钟；不能把 `getTimedTask(id)!=null` 当作已被 OS 安排的证明。计划数量应设实际边界。[TimedTaskScheduler](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/timing/TimedTaskScheduler.kt) |
| `scheduleTaskIfNeeded` 看到 `nextTime<=now` 会立即 `runTask`。 | **一次性过期任务会补触发**，重启也可能走此分支；必须在自己的 wake 入口先检查 deadline，再决定是否业务执行。 |
| AlarmReceiver / WorkWorker 调 `handleIntent` 后立刻 `notifyTaskFinished(id)`，一次性任务被删除；Worker 返回 success。 | 宿主完成状态只指已分发，不是脚本执行完。不存在可依赖的业务失败重试/成功回调。[AlarmReceiver](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/timing/TimedTaskAlarmReceiver.kt)、[Work 后端](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/timing/WorkTimedTaskScheduler.kt)、[notifyTaskFinished](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/timing/TimedTaskManager.kt) |

**续约竞态：** 当前 disposable 已经触发后，唤醒脚本不要 `updateTask(原任务对象)` 来续下一轮。宿主可能随后仍删除原 ID，导致新安排消失。每轮应 `addDisposableTask` 生成新 ID，自己绑定新 `hostTaskId`；旧 ID 只用于本次幂等核对。这是依据上表分发/删除顺序得出的实现建议。

宿主虽声明 `LOCKED_BOOT_COMPLETED`，v6.7.0 Manifest 未见 `directBootAware`，数据库也未使用 device-protected context；不能承诺开机第一次解锁前恢复。正常重启后还受首次解锁及品牌自启动策略影响。[Manifest](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/AndroidManifest.xml#L635)、[Android Direct Boot](https://developer.android.com/privacy-and-security/direct-boot)

## 3. Android 限制仍然存在

- **精确闹钟：** Android 12+ 的能力/授权、用户撤销和系统策略仍要满足。AutoJs6 Manifest 声明了 `USE_EXACT_ALARM` 与 `SCHEDULE_EXACT_ALARM`，但不能以源码声明代替当前手机的授权检查。宿主 Alarm 失败会退回延迟执行路径。[宿主 Manifest](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/AndroidManifest.xml#L75)、[Android 闹钟文档](https://developer.android.com/develop/background-work/services/alarms)
- **Doze：** 普通闹钟、网络、jobs/WorkManager 会延后；`setExactAndAllowWhileIdle` 可在 idle 触发，但每应用此类 idle 闹钟的频率不能高于每 9 分钟一次。**因此 `* * * * *` 可以有 Cron 语义，却不能保证熄屏深度 idle 时每分钟准时触发。** 延迟超 10 秒就跳过业务，是保持桌面规则的一种明确结果。[Doze](https://developer.android.com/training/monitoring-device-state/doze-standby)
- **WorkManager：** 周期最短 15 分钟且实际时间由约束及优化决定；宿主 20 分钟维护检查不能替代分钟 Cron 的准点计时器。[WorkManager](https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started/define-work)
- **前台服务：** target 31+ 后台启动有例外限制，target 34+ 要有合适类型/权限；Android 16 连前台服务内的 WorkManager jobs 也受额度约束。AutoJs6 的 AppForegroundService 声明为 `specialUse`，不能误套成 dataSync 的六小时规则，也不能据此承诺后台永活。精确闹钟启动例外也不等于能解锁、无条件弹 UI 或永久录屏。[版本变化](https://developer.android.com/develop/background-work/services/fgs/changes)、[后台启动限制](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)、[宿主服务声明](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/AndroidManifest.xml#L414)

本项目依赖截图的业务还会受到截屏授权/会话生命周期影响；后台无交互入口应在权限不可用时记录失败/需要处理，不能弹出等待输入的对话框并一直占锁。本文未证明现有截图流程可在重启后自动恢复。

## 4. 内置 Cron 库与加载 DEX

### 宿主没有可直接依赖的内置标准 Cron API

已对缓存的官方 v6.7.0 完整文件树、32 个 Gradle/版本目录文件做关键词检查，未发现 `quartz`、`cron-utils`、标准 Cron 解析模块/声明。宿主明确有 **Joda-Time 2.14.0、WorkManager 2.11.0、java.time desugar**，这些不等于五段 Cron 解析器。[app/build.gradle.kts](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/build.gradle.kts)、[libs.versions.toml](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/gradle/libs.versions.toml)

**证据边界：** 本次未枚举用户手机已安装 APK 的 DEX 类或解析全部传递依赖，不能断言任何发布构建绝不可能含同名类；结论是没有可依据的公开内置 API/构建依赖，产品代码不应假定可直接 import Quartz/cron-utils。

### 不新增 APK 加载受信 DEX：源码支持

精确 Java/Rhino 方法为：

```text
runtime.loadDex(vararg path: String): Unit
runtime.loadDex(dir: String, isRecursive: Boolean): Unit
runtime.loadJar(vararg paths: String): Unit
runtime.loadJar(dir: String, isRecursive: Boolean): Unit
```

`ScriptRuntime` 调全局 `AndroidClassLoader`；后者把 DEX 复制到宿主私有 cache，设只读，再用 `DexClassLoader` 加载，代码已显式处理 Android 14+ 可写 DEX 限制。`loadJar` 还有设备端 DX/D8 转换路径，但这不是运行时依赖下载器或任意 Maven JAR 一定可用的保证。[运行时方法](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/runtime/ScriptRuntime.kt#L551)、[AndroidClassLoader](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/rhino/AndroidClassLoader.kt)

**建议：** 在发布侧预制包含必要依赖的 DEX，固定版本与 SHA-256，沿已有脚本包字节校验路径写入私有目录；加载前校验，不在客户手机现场编译 Maven 工程。宿主内部的 MD5 缓存比较不是来源认证。Android 官方要求动态代码只读、可信存储、加载前完整性检查。[Android 14 DCL](https://developer.android.com/about/versions/14/behavior-changes-14#safer-dynamic-code-loading)、[动态代码安全](https://developer.android.com/privacy-and-security/risks/dynamic-code-loading)

```js
// io 为项目已有 AutoJs6 runtime adapter；hash 来自受信发布清单。
if (io.sha256(io.readBytes(dexPath)) !== expectedSha256)
  throw new Error('Cron 组件校验失败');
runtime.loadDex(dexPath);
```

### cron-utils 可选用法，仍需与桌面对齐

上游 cron-utils 9.2.1 的 `CronType.UNIX` 是五段，周日 0/7 映射，日与星期都受限时采用 OR；`CronType.QUARTZ` 则为 6/7 段，不能直接用来解析桌面五段。`ExecutionTime.nextExecution(ZonedDateTime)` 返回 `Optional<ZonedDateTime>`，支持显式 ZoneId。库是 Apache-2.0；POM 含 slf4j-api 等依赖，不能只把裸 cron-utils.jar 改名 dex 就算集成。[UNIX 定义](https://github.com/jmrozanec/cron-utils/blob/9.2.1/src/main/java/com/cronutils/model/definition/CronDefinitionBuilder.java#L497)、[OR 分支](https://github.com/jmrozanec/cron-utils/blob/9.2.1/src/main/java/com/cronutils/model/time/SingleExecutionTime.java#L672)、[ExecutionTime](https://github.com/jmrozanec/cron-utils/blob/9.2.1/src/main/java/com/cronutils/model/time/ExecutionTime.java)、[依赖 POM](https://github.com/jmrozanec/cron-utils/blob/9.2.1/pom.xml)、[许可](https://github.com/jmrozanec/cron-utils/blob/9.2.1/LICENSE)

DEX 已经正确打包并加载后，最小调用形态如下，**本次未构建或运行验证**：

```js
var C = Packages.com.cronutils;
var parser = new C.parser.CronParser(
  C.model.definition.CronDefinitionBuilder.instanceDefinitionFor(C.model.CronType.UNIX));
var parsed = parser.parse('0 9 * * 1-5');
parsed.validate();
var cursor = java.time.ZonedDateTime.ofInstant(
  java.time.Instant.ofEpochMilli(Date.now()), java.time.ZoneId.of('Asia/Shanghai'));
var next = C.model.time.ExecutionTime.forCron(parsed).nextExecution(cursor);
if (!next.isPresent()) throw new Error('Cron 没有未来时点');
var nextAt = Number(next.get().toInstant().toEpochMilli());
```

仍须保留桌面输入边界：最多 200 字符、严格五段、仅 `*,-/` 和数字/月份星期缩写；禁止 Quartz 扩展、`@daily`、多表达式 `|`。DST 缺失时刻跳过、回拨只取第一次，不能仅凭库支持时区就宣称一致；需要用桌面已有案例做同一组期望 epoch 对比，再给手机计算适配层加必要过滤。

## 5. 结合当前项目的最小状态流程

**现状事实：** [schedule.rs](../src-tauri/src/schedule.rs) 已有五段/IANA 时区、10 秒宽限、重启只算未来、先推进游标落盘再分发、重叠跳过和失败不自动重试。手机 [runtime-autojs6.js](../mobile/autojs6/runtime-autojs6.js) 已有私有目录、原子写文件及 `FileChannel.tryLock()`；[updater-core.cjs](../mobile/autojs6/updater-core.cjs) 的 operation.lock 覆盖当前运行/更新，且已有版本目录与逐文件 SHA-256。应复用这些机制，不再引入另一套常驻服务。

当前 `manager.run(packageId)` 读取**当前安装版本和当前配置**，而 [wechat-suite/main.js](../mobile-workflows/wechat-suite/src/main.js) 顶层只是导出交互函数，内部菜单/确认依赖用户操作。因此直接把此文件路径交给 tasks，既不等于调用导出函数，也不满足冻结快照的后台执行。需要独立顶层 wake 入口和可由同一业务核心执行的无交互路径；本文只提出要求，未改代码。

建议采用以下 5 步：

1. **创建/编辑计划：** 在本机保存 `{id, cron, timezone, enabled, workflowSnapshot, configSnapshot, nextAt, hostTaskId, generation, lastStatus}`。快照固定代码清单/版本/摘要与配置，保留被计划引用的版本目录；更新商店不静默替换计划。校验凭据引用，不把原始密钥复制进日志。
2. **安排唤醒：** 计算严格晚于 now 的下一 epoch，登记新的 disposable，并核对 nextTime/ID。短时间持有调度文件锁，保存绑定；仅清理自己入口路径/ID对应的孤儿任务，不删除宿主其他用户任务。跨宿主 DB 与自有 JSON 无原子事务，靠 hostTaskId/generation 校验及重建修复注册/落盘中断。
3. **收到 wake：** 先核对 enabled、宿主 ID/generation、计划时点；已消费/已编辑的旧唤醒直接忽略。超过 10 秒记录 skipped，不触发业务。先推进未来游标并登记**新 ID**下一轮，再落盘消费结果；同计划运行中跳过，手机 operation.lock 被手动运行/更新占用也跳过，不排队到错过时点后再发送。
4. **执行业务：** 非阻塞取得运行锁；保存 running 记录后才做 UI/网络副作用，固定调用快照版本与配置。结束保存成功/失败/不确定；失败不自动重发。进程退出遗留 running 只标 interrupted，不把它恢复为待执行。调度元数据锁不要跨整个工作流持有，否则后续唤醒无法及时记录重叠跳过。
5. **恢复/启停/卸载：** 启动器打开或宿主 startup recovery 只重建未来任务，不执行旧 occurrence。若注册失败/快照缺失，暂停并保留诊断；暂停/删除取消所属宿主 ID。重建、worker 被延迟或唤醒入口未启动，只影响未来恢复，不能借“补偿”自动重放可能已经发送的轮次。

**特有限制：** 一次性任务在脚本启动前后就会被宿主删除；若进程恰在脚本尚未安排下一轮时崩溃，单纯“自己链自己”会断链。因此需要 startup/reconcile 恢复入口。恢复入口受系统启动限制，不能承诺任意强行停止后还能无人干预恢复；发生这类中断允许漏跑，保持“不自动重复发送”优先于追补。

## 6. 每次触发新引擎不能继承上轮截屏授权

**v6.7.0 源码事实：**

1. `ScriptRuntime` 为每个运行时新建 `ApiImages`；`mScreenCapturer` 是这个 Images 实例的字段，不是跨脚本全局会话。[ScriptRuntime 初始化](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/runtime/ScriptRuntime.kt#L471)、[Images 字段](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/runtime/api/Images.java#L122)
2. 同步/异步 `requestScreenCapture` 的 JS 包装都会先 `stopScreenCapture` 再请求；无会话时 `ScreenCaptureRequester` 使用 `createScreenCaptureIntent()` 拉起授权 Activity，成功后创建 MediaProjection。**重复调用 request 并非“检查旧授权”。**[Images 包装](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/runtime/api/augment/images/Images.kt#L303)、[授权请求](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/core/image/capture/ScreenCaptureRequester.java)、[Projection 创建](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/core/image/capture/ScreenCapturer.java#L126)
3. `ScriptRuntime.onExit()` 调 `images.releaseScreenCapturer()` 与 `images.stopScreenCapturerForegroundService()`；`ScreenCapturer.release()` 会停止 MediaProjection。正常脚本结束即释放，宿主进程仍在也不能把上轮会话视作可用。[退出释放](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/runtime/ScriptRuntime.kt#L635)、[release](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/core/image/capture/ScreenCapturer.java#L467)
4. 同一轮已授权并保有 capturer 时，直接多次 `captureScreen()` 使用当前实例；若不存在，非 UI 线程的 captureScreen 包装还会自动请求授权。因此“没有显式调用 request”也不能保证后台不会弹授权界面。[captureScreen 包装](https://github.com/SuperMonster003/AutoJs6/blob/v6.7.0/app/src/main/java/org/autojs/autojs/runtime/api/augment/images/Images.kt#L288)

**对拟采用方案的推论：** root 下稳定模块是稳定的**文件**，不是永久运行时。每次小入口新建一个定时脚本引擎，即使 require 同一个模块，也不能继承启动器或上次任务的 MediaProjection；“用户手动授权一次，随后所有独立定时脚本都自动截图”没有此源码路径支持。Android 14+ 的会话 token 一次使用限制进一步阻止持久化旧授权 Intent 重放，不能把保存 token 当修复。

**最小交付建议：** 调度机制可先独立完成，但依赖图片的任务必须明确“当前轮截屏会话可用”这个前提，授权不可用时安全失败/需要用户处理，失败不自动重发；不要用一次菜单授权冒充永久授权。若必须持续无人值守截图，需要另行设计单一持有者的长运行会话及中断恢复，不能由新增 tasks 接口自动解决，也仍不保证进程永活。当前手机保持不动，本次没有验证实际系统会呈现哪些授权按钮。

## 7. 后续验证边界

**无需手机即可先测：** 五段语法/缩写/周日0与7/日星期OR、跨月与闰日、IANA区、DST缺口与首次回拨；与 Rust 测试使用同一预期 epoch。状态机覆盖迟到、重复 wake、编辑后旧 ID、运行重叠、业务失败、注册/落盘中断和快照版本冻结。DEX 的 JVM/Android API及依赖完整性在发布侧验证。

**仍需真机确认：** AutoJs6 6.7.0 注册返回值与 Intent 参数、关闭启动器后触发、宿主进程重启/设备重启后的恢复、exact-alarm授权和回退、Doze分钟任务跳过、DEX在目标Android的加载、当前截图授权失效时的失败行为。所有测试先使用只写日志的假工作流；用户完成企业微信登录前保持手机不动。

本次只新增此研究文档；未修改实现、构建、提交或创建分支。最小方案仍不能承诺秒级开始、后台永活或“必定执行一次”；可以实现本地持久计划、可解释跳过和避免自动重发。
