package com.por.auto.agent

import android.app.ActivityManager
import android.app.Application
import android.content.Intent
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.por.auto.agent.a11y.AgentAccessibilityService
import com.por.auto.agent.ai.AiClient
import com.por.auto.agent.ai.AiConfig
import com.por.auto.agent.ai.AiConfigStore
import com.por.auto.agent.ai.AiProvider
import com.por.auto.agent.assistant.AgentService
import com.por.auto.agent.assistant.AgentSession
import com.por.auto.agent.assistant.AgentTurn
import com.por.auto.agent.schedule.AlarmScheduler
import com.por.auto.agent.schedule.BroadcastService
import com.por.auto.agent.schedule.RepeatKind
import com.por.auto.agent.schedule.Schedule
import com.por.auto.agent.schedule.ScheduleStore
import com.por.auto.agent.task.Task
import com.por.auto.agent.task.TaskKind
import com.por.auto.agent.task.TaskStore
import com.por.auto.agent.wecom.BroadcastResult
import com.por.auto.agent.wecom.RecipientResult
import com.por.auto.agent.wecom.RunRecord
import com.por.auto.agent.wecom.RunMeta
import com.por.auto.agent.wecom.RunNotifier
import com.por.auto.agent.wecom.RunStore
import com.por.auto.agent.ui.ThemeMode
import com.por.auto.agent.ui.ThemeStore
import com.por.auto.agent.update.ReleaseInfo
import com.por.auto.agent.update.RunUploads
import com.por.auto.agent.update.UpdateChecker
import com.por.auto.agent.wecom.WecomBroadcastRunner
import com.por.auto.agent.wecom.WecomScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.File
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** 一次没跑完的任务：正文、范围、模式和剩下的会话都按原样保存，续跑不改内容。 */
data class ResumeJob(
    val text: String,
    val scope: WecomScope,
    val dryRun: Boolean,
    val remaining: List<String>,
)

/** 更新检查的状态：release 有值表示服务端有更新，file 有值表示已下载完。 */
data class UpdateState(
    val busy: Boolean = false,
    val message: String? = null,
    val release: ReleaseInfo? = null,
    val file: File? = null,
)

data class MainUiState(
    val accessibilityEnabled: Boolean = false,
    val message: String? = null,
    val p1Running: Boolean = false,
    val p1DryRunText: String? = null,
    val p1DryRunScope: WecomScope? = null,
    val p1Log: List<String> = emptyList(),
    val p1Results: List<RecipientResult> = emptyList(),
    /** 上次没处理成功的会话；有值时界面可以只补发这些。 */
    val p1Resume: ResumeJob? = null,
    val schedules: List<Schedule> = emptyList(),
    val exactAlarmAllowed: Boolean = true,
    val runs: List<RunRecord> = emptyList(),
    val aiConfig: AiConfig = AiConfig(),
    /** 已保存的明文 Key，用来回填设置页；只在本机内存里。 */
    val aiKey: String = "",
    val aiModels: List<String> = emptyList(),
    val aiBusy: Boolean = false,
    val aiStatus: String? = null,
    val aiDraft: String? = null,
    val aiDraftScope: WecomScope? = null,
    val agentRunning: Boolean = false,
    val agentTurns: List<AgentTurn> = emptyList(),
    val tasks: List<Task> = emptyList(),
    val update: UpdateState = UpdateState(),
    val notificationsEnabled: Boolean = true,
    val theme: ThemeMode = ThemeMode.System,
) {
    /** 正式发送只认「同样的正文 + 同样的范围」跑过的试运行。 */
    fun rehearsed(text: String, scope: WecomScope): Boolean =
        p1DryRunText == text && p1DryRunScope == scope
}

class MainViewModel(application: Application) : AndroidViewModel(application) {

    private val _state = MutableStateFlow(MainUiState())
    val state: StateFlow<MainUiState> = _state.asStateFlow()

    private var retriedUploads = false
    /** 正在跑的任务；群发结束后把结果写回任务。 */
    private var activeTaskId: String? = null

    init {
        viewModelScope.launch {
            AgentSession.turns.collect { turns -> _state.update { it.copy(agentTurns = turns) } }
        }
        viewModelScope.launch {
            AgentSession.running.collect { running -> _state.update { it.copy(agentRunning = running) } }
        }
    }

    fun refresh() {
        val current = _state.value.theme
        val saved = ThemeStore(getApplication()).load()
        if (saved != current) _state.update { it.copy(theme = saved) }
        if (!retriedUploads) {
            retriedUploads = true
            RunUploads.retryPending(getApplication())
        }
        val app = getApplication<Application>()
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val lastRun = RunStore(app).latest()
                val schedules = ScheduleStore(app).all()
                val tasks = TaskStore(app).all()
                val runs = RunStore(app).history()
                val aiStore = AiConfigStore(app)
                val aiConfig = aiStore.load()
                val aiKey = runCatching { aiStore.keyFor(aiConfig.provider, aiConfig.baseUrl, "") }
                    .getOrDefault("")
                _state.update { current ->
                    current.copy(
                        accessibilityEnabled = AgentAccessibilityService.isRunning,
                        p1Results = current.p1Results.ifEmpty { lastRun?.results.orEmpty() },
                        schedules = schedules,
                        tasks = tasks,
                        exactAlarmAllowed = AlarmScheduler(app).canScheduleExact(),
                        runs = runs,
                        aiConfig = aiConfig,
                        aiKey = aiKey,
                        notificationsEnabled = NotificationManagerCompat.from(app).areNotificationsEnabled(),
                    )
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(message = "读取记录失败：${e.message}") }
            }
        }
    }

    fun runBroadcast(dryRun: Boolean, text: String, scope: WecomScope, only: List<String>? = null) {
        if (_state.value.p1Running) return
        val service = AgentAccessibilityService.instance
        if (service == null) {
            _state.update { it.copy(message = "无障碍服务未开启") }
            return
        }
        _state.update {
            it.copy(
                p1Running = true,
                p1Resume = null,
                p1Log = emptyList(),
                p1Results = emptyList(),
                message = if (dryRun) "试运行中…" else "发送中…",
            )
        }
        val startedAt = System.currentTimeMillis()
        service.showRunStatus(if (dryRun) "正在试运行…" else "正在发送…")
        // 群发会切到企微，挂个前台服务，别让系统在后台把进程回收。
        val keepAliveApp = getApplication<Application>()
        AgentService.start(keepAliveApp, "群发任务", if (dryRun) "正在试运行…" else "正在发送…")
        viewModelScope.launch(Dispatchers.IO) {
            val runner = WecomBroadcastRunner(service) { line ->
                service.updateRunStatus(line)
                _state.update { state -> state.copy(p1Log = (state.p1Log + line).takeLast(400)) }
            }
            val result = runCatching {
                runner.run(text, scope, dryRun, only)
            }.getOrElse {
                if (it is CancellationException) throw it
                BroadcastResult(
                    dryRun = dryRun,
                    results = listOf(RecipientResult("—", scope, "failed", it.message)),
                    error = it.message ?: it.javaClass.simpleName,
                )
            }
            val app = getApplication<Application>()
            val meta = RunMeta(
                kind = "broadcast",
                startedAt = startedAt,
                scope = scope,
                text = text,
                log = _state.value.p1Log,
                device = RunMeta.device(app),
            )
            val saved = runCatching { RunStore(app).save(result, meta) }.getOrNull()
            val runs = RunStore(getApplication()).history()
            _state.update {
                it.copy(
                    p1Running = false,
                    // 只有「覆盖全部收件人」的试运行才授权正式发送；正式发送不推翻已有结论。
                    p1DryRunText = when {
                        result.rehearsed && only == null -> text
                        dryRun -> null
                        else -> it.p1DryRunText
                    },
                    p1DryRunScope = when {
                        result.rehearsed && only == null -> scope
                        dryRun -> null
                        else -> it.p1DryRunScope
                    },
                    p1Resume = result.results
                        .filter { r -> r.status == "failed" || r.status == "skipped" }
                        .map { it.title }
                        .filter { it != "—" }
                        .takeIf { it.isNotEmpty() }
                        ?.let { ResumeJob(text = text, scope = scope, dryRun = dryRun, remaining = it) },
                    p1Results = result.results,
                    runs = runs,
                    message = when {
                        result.error != null -> "停止：${result.error}"
                        dryRun -> "试运行完成：${result.completed} 个"
                        else -> "发送完成：${result.completed} 个"
                    },
                )
            }
            saved?.let { file -> RunUploads.enqueue(file) }
            activeTaskId?.let { taskId ->
                activeTaskId = null
                val status = when {
                    dryRun && result.error == null && result.rehearsed -> "rehearsed"
                    !dryRun && result.error == null -> "sent"
                    else -> "failed"
                }
                runCatching {
                    TaskStore(app).update(taskId) {
                        it.copy(
                            lastRunAt = System.currentTimeMillis(),
                            lastStatus = status,
                            lastError = result.error,
                        )
                    }
                }
                refreshTasks()
            }
            service.hideRunStatus()
            runCatching {
                RunNotifier(app).show(
                    if (dryRun) "试运行完成" else "发送完成",
                    "${result.completed} 个会话 · 点这里回到 PorAuto",
                )
            }
            bringAppForward()
            AgentService.stop(app)
        }
    }

    /** 群发跑完把界面带回前台，别把人留在企微里。 */
    private fun bringAppForward() {
        val app = getApplication<Application>()
        // 先从最近任务里把自己的任务提到最前：国产 ROM 对后台 startActivity 卡得严，这条更容易被放行。
        runCatching {
            app.getSystemService(ActivityManager::class.java)?.appTasks?.firstOrNull()?.moveToFront()
        }
        runCatching {
            app.startActivity(
                Intent(app, MainActivity::class.java).addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP,
                ),
            )
        }
    }

    /** 通用助手：把一句话交给模型，按屏幕一步步操作。跑在前台服务里，随时可停。 */
    fun startAgent(goal: String) {
        if (_state.value.agentRunning) return
        val error = AgentSession.start(getApplication(), goal)
        if (error != null) _state.update { it.copy(message = error) }
    }

    fun stopAgent() {
        AgentSession.stop(getApplication())
    }

    fun newAgentSession() {
        AgentSession.clear()
    }

    fun addTask(title: String, kind: TaskKind, prompt: String, message: String, scope: WecomScope) {
        val error = when (kind) {
            TaskKind.Agent -> if (prompt.isBlank()) "任务目标不能为空" else null
            TaskKind.Wecom -> runCatching { WecomBroadcastRunner.validateText(message) }
                .exceptionOrNull()?.message
        }
        if (error != null) {
            _state.update { it.copy(message = error) }
            return
        }
        val task = Task.create(title, kind, prompt = prompt, message = message, scope = scope)
        val app = getApplication<Application>()
        viewModelScope.launch(Dispatchers.IO) {
            TaskStore(app).upsert(task)
            refreshTasks()
            _state.update { it.copy(message = "已添加任务「${task.title}」") }
        }
    }

    fun deleteTask(id: String) {
        val app = getApplication<Application>()
        viewModelScope.launch(Dispatchers.IO) {
            TaskStore(app).remove(id)
            refreshTasks()
        }
    }

    /** 试运行：AI 任务直接交给助手跑一次；群发任务只写草稿再清理。 */
    fun trialTask(task: Task) {
        when (task.kind) {
            TaskKind.Agent -> {
                val error = AgentSession.start(getApplication(), task.prompt)
                if (error != null) {
                    _state.update { it.copy(message = error) }
                } else {
                    markTask(task.id, "started", null)
                }
            }
            TaskKind.Wecom -> {
                activeTaskId = task.id
                runBroadcast(dryRun = true, text = task.message, scope = task.scope)
            }
        }
    }

    /** 群发任务必须先试运行成功，才允许正式发送。 */
    fun sendTask(task: Task) {
        if (task.kind == TaskKind.Agent) {
            trialTask(task)
            return
        }
        if (task.lastStatus != "rehearsed") {
            _state.update { it.copy(message = "先试运行成功，再正式发送") }
            return
        }
        activeTaskId = task.id
        runBroadcast(dryRun = false, text = task.message, scope = task.scope)
    }

    private fun markTask(id: String, status: String, error: String?) {
        val app = getApplication<Application>()
        viewModelScope.launch(Dispatchers.IO) {
            TaskStore(app).update(id) {
                it.copy(lastRunAt = System.currentTimeMillis(), lastStatus = status, lastError = error)
            }
            refreshTasks()
        }
    }

    private fun refreshTasks() {
        val tasks = TaskStore(getApplication()).all()
        _state.update { it.copy(tasks = tasks) }
    }

    /** 只补发上次没成功的会话，正文和范围沿用原任务。 */
    fun resumeBroadcast() {
        val job = _state.value.p1Resume ?: return
        runBroadcast(job.dryRun, job.text, job.scope, job.remaining)
    }

    fun addSchedule(taskId: String, repeat: RepeatKind, hour: Int, minute: Int, intervalMinutes: Int) {
        if (hour !in 0..23 || minute !in 0..59) {
            _state.update { it.copy(message = "时间无效，小时 0-23、分钟 0-59") }
            return
        }
        if (intervalMinutes !in 5..1440) {
            _state.update { it.copy(message = "间隔应在 5 分钟到 24 小时之间") }
            return
        }
        val app = getApplication<Application>()
        changeSchedules { store, scheduler ->
            val task = TaskStore(app).find(taskId)
            if (task == null) {
                _state.update { it.copy(message = "任务不存在，先去任务页添加") }
                return@changeSchedules
            }
            val schedule = Schedule.create(
                text = task.title,
                hour = hour,
                minute = minute,
                scope = task.scope,
                repeat = repeat,
                intervalMinutes = intervalMinutes,
                taskId = task.id,
            )
            store.upsert(schedule)
            scheduler.schedule(schedule)
        }
    }

    fun updateSchedule(id: String, repeat: RepeatKind, hour: Int, minute: Int, intervalMinutes: Int) {
        changeSchedules { store, scheduler ->
            val updated = store.update(id) { current ->
                val draft = current.copy(
                    repeat = repeat,
                    hour = hour,
                    minute = minute,
                    intervalMinutes = intervalMinutes,
                )
                draft.copy(nextAtMs = draft.nextAfter(System.currentTimeMillis()))
            }
            updated?.let(scheduler::schedule)
        }
    }

    fun toggleSchedule(id: String, enabled: Boolean) {
        changeSchedules { store, scheduler ->
            val updated = store.update(id) { schedule ->
                val next = if (enabled) {
                    Schedule.nextOccurrence(schedule.hour, schedule.minute, System.currentTimeMillis())
                } else {
                    schedule.nextAtMs
                }
                schedule.copy(enabled = enabled, nextAtMs = next)
            }
            updated?.let(scheduler::schedule)
        }
    }

    fun deleteSchedule(id: String) {
        changeSchedules { store, scheduler ->
            store.remove(id)
            scheduler.cancel(id)
        }
    }

    fun runScheduleNow(id: String) {
        val app = getApplication<Application>()
        runCatching {
            ContextCompat.startForegroundService(
                app,
                Intent(app, BroadcastService::class.java)
                    .setAction(BroadcastService.ACTION_RUN)
                    .putExtra(BroadcastService.EXTRA_ID, id)
                    .putExtra(BroadcastService.EXTRA_RUN_NOW, true),
            )
        }.onSuccess {
            _state.update { it.copy(message = "已开始执行，结果会显示在通知里") }
        }.onFailure { error ->
            _state.update { it.copy(message = "无法启动任务：${error.message}") }
        }
    }

    private fun changeSchedules(change: (ScheduleStore, AlarmScheduler) -> Unit) {
        val app = getApplication<Application>()
        viewModelScope.launch(Dispatchers.IO) {
            runCatching {
                change(ScheduleStore(app), AlarmScheduler(app))
                refreshSchedules()
            }.onFailure { error ->
                _state.update { it.copy(message = "修改定时任务失败：${error.message}") }
            }
        }
    }

    private fun refreshSchedules() {
        val app = getApplication<Application>()
        val schedules = ScheduleStore(app).all()
        val exactAlarmAllowed = AlarmScheduler(app).canScheduleExact()
        _state.update {
            it.copy(
                schedules = schedules,
                exactAlarmAllowed = exactAlarmAllowed,
            )
        }
    }

    fun fetchAiModels(provider: AiProvider, baseUrl: String, apiKey: String) {
        if (_state.value.aiBusy) return
        _state.update { it.copy(aiBusy = true, aiStatus = "正在获取模型…") }
        viewModelScope.launch(Dispatchers.IO) {
            val config = AiConfig(provider = provider, baseUrl = baseUrl.trim(), model = "", hasKey = true,
                sessionId = AiConfigStore(getApplication()).sessionId(),
            )
            val result = runCatching {
                val supplied = keyForEndpoint(provider, baseUrl, apiKey)
                val key = AiConfigStore(getApplication()).keyFor(provider, baseUrl, supplied)
                AiClient().fetchModels(config, key)
            }.onFailure { if (it is CancellationException) throw it }
            _state.update {
                it.copy(
                    aiBusy = false,
                    aiModels = result.getOrDefault(emptyList()),
                    aiStatus = result.fold(
                        onSuccess = { models -> if (models.isEmpty()) "没有拿到模型" else "拿到 ${models.size} 个模型" },
                        onFailure = { error -> "获取失败：${error.message}" },
                    ),
                )
            }
        }
    }

    fun saveAi(provider: AiProvider, baseUrl: String, apiKey: String, model: String, test: Boolean) {
        if (_state.value.aiBusy) return
        if (baseUrl.isBlank() || model.isBlank()) {
            _state.update { it.copy(aiStatus = "请填写 Base URL 并选择模型") }
            return
        }
        _state.update { it.copy(aiBusy = true, aiStatus = "正在保存…") }
        viewModelScope.launch(Dispatchers.IO) {
            val store = AiConfigStore(getApplication())
            val result = runCatching {
                val supplied = keyForEndpoint(provider, baseUrl, apiKey)
                store.save(AiConfig(provider, baseUrl.trim(), model, hasKey = true), supplied)
                val config = store.load()
                val key = supplied.ifBlank {
                    runCatching { store.keyFor(provider, baseUrl, "") }.getOrDefault("")
                }
                _state.update { it.copy(aiConfig = config, aiKey = key) }
                if (test) {
                    val reply = AiClient().chat(config, store.keyFor(provider, baseUrl, key), "回复两个字：可用")
                    "测试通过：${reply.take(40)}"
                } else {
                    "已保存"
                }
            }.onFailure { if (it is CancellationException) throw it }
            _state.update {
                it.copy(
                    aiBusy = false,
                    aiStatus = result.fold(
                        onSuccess = { it },
                        onFailure = { error -> "保存或测试失败：${error.message}" },
                    ),
                )
            }
        }
    }

    /** 换协议或 Base URL 后必须重新输入 Key，不能把旧 Key 悄悄发给新地址。 */
    private fun keyForEndpoint(provider: AiProvider, baseUrl: String, typed: String): String {
        val current = _state.value
        return if (current.aiConfig.sameEndpoint(provider, baseUrl)) {
            typed
        } else {
            typed.takeIf { it != current.aiKey }.orEmpty()
        }
    }

    fun aiGenerate(instruction: String) {
        if (_state.value.aiBusy) return
        if (!_state.value.aiConfig.ready) {
            _state.update { it.copy(aiStatus = "请先在设置里配置 AI") }
            return
        }
        if (instruction.isBlank()) {
            _state.update { it.copy(aiStatus = "先说一句想让 AI 写什么") }
            return
        }
        _state.update { it.copy(aiBusy = true, aiStatus = "AI 正在生成…") }
        viewModelScope.launch(Dispatchers.IO) {
            val result = runCatching {
                val store = AiConfigStore(getApplication())
                val config = store.load()
                AiClient().plan(config, store.keyFor(config.provider, config.baseUrl, ""), instruction)
            }.onFailure { if (it is CancellationException) throw it }
            _state.update {
                it.copy(
                    aiBusy = false,
                    aiStatus = result.fold(
                        onSuccess = { plan ->
                            if (plan.scopeKey == null) "已生成，范围请自己选" else "已填好消息和范围，请检查"
                        },
                        onFailure = { error -> "生成失败：${error.message}" },
                    ),
                    aiDraft = result.getOrNull()?.text,
                    aiDraftScope = result.getOrNull()?.scopeKey?.let { key ->
                        runCatching { WecomScope.fromKey(key) }.getOrNull()
                    },
                )
            }
        }
    }

    fun consumeAiDraft() {
        _state.update { it.copy(aiDraft = null, aiDraftScope = null) }
    }

    fun setTheme(mode: ThemeMode) {
        ThemeStore(getApplication()).save(mode)
        _state.update { it.copy(theme = mode) }
    }

    fun checkUpdate() {
        if (_state.value.update.busy) return
        _state.update { it.copy(update = it.update.copy(busy = true, message = "正在检查…")) }
        viewModelScope.launch {
            val checker = UpdateChecker(getApplication())
            val result = runCatching {
                checker.latest()?.takeIf { it.versionCode > checker.currentVersionCode() }
            }.onFailure { if (it is CancellationException) throw it }
            _state.update { current ->
                val update = result.fold(
                    onSuccess = { release ->
                        if (release == null) {
                            UpdateState(message = "已经是最新版本")
                        } else {
                            UpdateState(release = release, message = "有新版本 ${release.versionName}")
                        }
                    },
                    onFailure = { UpdateState(message = it.message ?: "检查更新失败") },
                )
                current.copy(update = update)
            }
        }
    }

    fun downloadUpdate() {
        val release = _state.value.update.release ?: return
        if (_state.value.update.busy) return
        _state.update { it.copy(update = it.update.copy(busy = true, message = "正在下载…")) }
        viewModelScope.launch {
            val checker = UpdateChecker(getApplication())
            val file = runCatching { checker.download(release) }
                .onFailure { if (it is CancellationException) throw it }
                .getOrElse { error ->
                    _state.update {
                        it.copy(update = UpdateState(release = release, message = error.message))
                    }
                    return@launch
                }
            _state.update {
                it.copy(update = UpdateState(release = release, file = file, message = "已下载，正在安装"))
            }
            runCatching { checker.install(file) }.onFailure { error ->
                _state.update {
                    it.copy(update = UpdateState(release = release, file = file, message = "打开安装失败：${error.message}"))
                }
            }
        }
    }

    fun dismissUpdate() {
        _state.update { it.copy(update = it.update.copy(release = null)) }
    }

}
