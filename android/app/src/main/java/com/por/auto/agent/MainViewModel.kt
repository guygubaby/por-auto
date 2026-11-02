package com.por.auto.agent

import android.app.Application
import android.content.Intent
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.por.auto.agent.a11y.AgentAccessibilityService
import com.por.auto.agent.a11y.ScreenReader
import com.por.auto.agent.a11y.SnapshotJson
import com.por.auto.agent.capture.CaptureNotifier
import com.por.auto.agent.capture.DumpStore
import com.por.auto.agent.ai.AiClient
import com.por.auto.agent.ai.AiConfig
import com.por.auto.agent.ai.AiConfigStore
import com.por.auto.agent.ai.AiProvider
import com.por.auto.agent.assistant.AgentRunner
import com.por.auto.agent.schedule.AlarmScheduler
import com.por.auto.agent.schedule.BroadcastService
import com.por.auto.agent.schedule.RepeatKind
import com.por.auto.agent.schedule.Schedule
import com.por.auto.agent.schedule.ScheduleStore
import com.por.auto.agent.wecom.BroadcastResult
import com.por.auto.agent.wecom.RecipientResult
import com.por.auto.agent.wecom.RunRecord
import com.por.auto.agent.wecom.RunMeta
import com.por.auto.agent.wecom.RunStore
import com.por.auto.agent.update.BackendClient
import com.por.auto.agent.update.PasscodeStore
import com.por.auto.agent.update.ReleaseInfo
import com.por.auto.agent.update.RunUploads
import com.por.auto.agent.update.sha256Hex
import com.por.auto.agent.update.UpdateChecker
import com.por.auto.agent.wecom.WecomBroadcastRunner
import com.por.auto.agent.wecom.WecomScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
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

/** 口令闸门：服务端设过口令且本地没通过（或服务端换了口令）时 required 为 true。 */
data class PasscodeState(
    val required: Boolean = false,
    val version: Int = 0,
    val busy: Boolean = false,
    val error: String? = null,
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
    val overlayVisible: Boolean = false,
    val latestJson: String? = null,
    val latestSummary: String? = null,
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
    val aiModels: List<String> = emptyList(),
    val aiBusy: Boolean = false,
    val aiStatus: String? = null,
    val aiDraft: String? = null,
    val aiDraftScope: WecomScope? = null,
    val agentRunning: Boolean = false,
    val agentSteps: List<String> = emptyList(),
    val agentStatus: String? = null,
    val update: UpdateState = UpdateState(),
    val passcode: PasscodeState = PasscodeState(),
) {
    /** 正式发送只认「同样的正文 + 同样的范围」跑过的试运行。 */
    fun rehearsed(text: String, scope: WecomScope): Boolean =
        p1DryRunText == text && p1DryRunScope == scope
}

class MainViewModel(application: Application) : AndroidViewModel(application) {

    private val _state = MutableStateFlow(MainUiState())
    val state: StateFlow<MainUiState> = _state.asStateFlow()

    private var aiSyncedVersion: Int? = null
    private var retriedUploads = false

    fun refresh() {
        if (!retriedUploads) {
            retriedUploads = true
            RunUploads.retryPending(getApplication())
        }
        // 每次回到前台都问一次服务端口令：管理员换了口令，这里就会重新要求输入。
        if (!_state.value.passcode.required) checkPasscode()
        val app = getApplication<Application>()
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val latest = DumpStore(app).latest()
                val lastRun = RunStore(app).latest()
                val schedules = ScheduleStore(app).all()
                val runs = RunStore(app).history()
                val aiConfig = AiConfigStore(app).load()
                _state.update { current ->
                    current.copy(
                        accessibilityEnabled = AgentAccessibilityService.isRunning,
                        overlayVisible = AgentAccessibilityService.instance?.overlayVisible == true,
                        latestJson = latest,
                        latestSummary = latest?.let(::summarize),
                        p1Results = current.p1Results.ifEmpty { lastRun?.results.orEmpty() },
                        schedules = schedules,
                        exactAlarmAllowed = AlarmScheduler(app).canScheduleExact(),
                        runs = runs,
                        aiConfig = aiConfig,
                    )
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(message = "读取记录失败：${e.message}") }
            }
        }
    }

    fun captureNow() {
        val service = AgentAccessibilityService.instance
        if (service == null) {
            _state.update { it.copy(message = "无障碍服务未开启") }
            return
        }
        viewModelScope.launch(Dispatchers.IO) {
            runCatching {
                val snapshot = ScreenReader.read(service)
                val json = SnapshotJson.encode(snapshot)
                DumpStore(getApplication()).save(json)
                snapshot to json
            }.onSuccess { (snapshot, json) ->
                _state.update {
                    it.copy(
                        accessibilityEnabled = true,
                        latestJson = json,
                        latestSummary = summarize(json),
                        message = "已读取 ${snapshot.elements.size} 个控件",
                    )
                }
            }.onFailure {
                _state.update { state ->
                    state.copy(message = "读取失败：${it.message ?: it.javaClass.simpleName}")
                }
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
        if (!dryRun && !_state.value.rehearsed(text, scope)) {
            _state.update { it.copy(message = "消息或范围已变化，请先试运行") }
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
            service.hideRunStatus()
            bringAppForward()
        }
    }

    /** 群发跑完把界面带回前台，别把人留在企微里。 */
    private fun bringAppForward() {
        val app = getApplication<Application>()
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

    private var agentJob: Job? = null

    /** 通用助手：把一句话交给模型，按屏幕一步步操作。随时可停。 */
    fun startAgent(goal: String) {
        if (_state.value.agentRunning) return
        val service = AgentAccessibilityService.instance
        if (service == null) {
            _state.update { it.copy(message = "无障碍服务未开启") }
            return
        }
        if (goal.isBlank()) {
            _state.update { it.copy(message = "先说一句要做什么") }
            return
        }
        if (!_state.value.aiConfig.ready) {
            _state.update { it.copy(message = "请先在设置里配置 AI") }
            return
        }
        _state.update {
            it.copy(
                agentRunning = true,
                agentSteps = emptyList(),
                agentStatus = "执行中…",
                message = null,
            )
        }
        service.showRunStatus("助手执行中…")
        agentJob = viewModelScope.launch(Dispatchers.IO) {
            val store = AiConfigStore(getApplication())
            val config = store.load()
            val runner = AgentRunner(
                service = service,
                client = AiClient(),
                config = config,
                key = store.keyFor(config.provider, config.baseUrl, ""),
                log = { line ->
                    service.updateRunStatus(line)
                    _state.update { state -> state.copy(agentSteps = (state.agentSteps + line).takeLast(40)) }
                },
            )
            val result = runCatching { runner.run(goal) }
            service.hideRunStatus()
            _state.update { state ->
                state.copy(
                    agentRunning = false,
                    agentStatus = result.fold(
                        onSuccess = { "完成：$it" },
                        onFailure = { error ->
                            if (error is CancellationException) "已停止" else "停止：${error.message}"
                        },
                    ),
                )
            }
        }
    }

    fun stopAgent() {
        agentJob?.cancel()
        agentJob = null
        AgentAccessibilityService.instance?.hideRunStatus()
        _state.update { it.copy(agentRunning = false, agentStatus = "已停止") }
    }

    /** 只补发上次没成功的会话，正文和范围沿用原任务。 */
    fun resumeBroadcast() {
        val job = _state.value.p1Resume ?: return
        runBroadcast(job.dryRun, job.text, job.scope, job.remaining)
    }

    fun addSchedule(
        text: String,
        repeat: RepeatKind,
        hour: Int,
        minute: Int,
        intervalMinutes: Int,
        scope: WecomScope,
    ) {
        val validation = runCatching { WecomBroadcastRunner.validateText(text) }
        if (validation.isFailure) {
            _state.update { it.copy(message = validation.exceptionOrNull()?.message) }
            return
        }
        if (hour !in 0..23 || minute !in 0..59) {
            _state.update { it.copy(message = "时间无效，小时 0-23、分钟 0-59") }
            return
        }
        if (intervalMinutes !in 5..1440) {
            _state.update { it.copy(message = "间隔应在 5 分钟到 24 小时之间") }
            return
        }
        changeSchedules { store, scheduler ->
            val schedule = Schedule.create(text, hour, minute, scope, repeat, intervalMinutes)
            store.upsert(schedule)
            scheduler.schedule(schedule)
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
                val key = AiConfigStore(getApplication()).keyFor(provider, baseUrl, apiKey)
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
                store.save(AiConfig(provider, baseUrl.trim(), model, hasKey = true), apiKey)
                val config = store.load()
                _state.update { it.copy(aiConfig = config) }
                if (test) {
                    val reply = AiClient().chat(config, store.keyFor(provider, baseUrl, ""), "回复两个字：可用")
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

    fun toggleOverlay() {
        val service = AgentAccessibilityService.instance
        if (service == null) {
            _state.update { it.copy(message = "无障碍服务未开启") }
            return
        }
        runCatching {
            if (service.overlayVisible) service.hideOverlay() else service.showOverlay()
        }.onSuccess {
            _state.update {
                it.copy(
                    overlayVisible = service.overlayVisible,
                    message = if (service.overlayVisible) "悬浮按钮已显示，去企微页面点「读屏」" else "悬浮按钮已隐藏",
                )
            }
        }.onFailure {
            _state.update { state ->
                state.copy(message = "悬浮按钮失败：${it.message ?: it.javaClass.simpleName}")
            }
        }
    }

    fun showCaptureNotification() {
        val app = getApplication<Application>()
        if (!NotificationManagerCompat.from(app).areNotificationsEnabled()) {
            _state.update { it.copy(message = "通知权限未开启，请在系统设置里允许通知") }
            return
        }
        CaptureNotifier(app).showReady()
        _state.update { it.copy(message = "已显示通知，去企微页面下拉通知栏") }
    }

    /** 启动时问一次服务端口令；没设口令或本地指纹一致就直接放行。 */
    fun checkPasscode() {
        viewModelScope.launch {
            val remote = runCatching { BackendClient().passcode() }
                .onFailure { if (it is CancellationException) throw it }
                .getOrNull() ?: return@launch
            val store = PasscodeStore(getApplication())
            // 服务端只给版本号；本地记的版本对不上就重新要口令。
            val required = store.version() != remote.version
            _state.update {
                it.copy(passcode = PasscodeState(required = required, version = remote.version))
            }
            if (!required) syncAiConfig(store.sha256(), remote.version)
        }
    }

    fun submitPasscode(input: String) {
        val state = _state.value.passcode
        if (state.busy) return
        val passcode = input.trim()
        if (passcode.isBlank()) {
            _state.update { it.copy(passcode = it.passcode.copy(error = "请输入口令")) }
            return
        }
        _state.update { it.copy(passcode = it.passcode.copy(busy = true, error = null)) }
        viewModelScope.launch {
            val sha = sha256Hex(passcode)
            // 直接用这个指纹去要配置：服务端认了才算通过，认不出就是口令不对。
            val result = runCatching { BackendClient().aiConfig(sha) }
                .onFailure { if (it is CancellationException) throw it }
            val failure = result.exceptionOrNull()
            if (failure != null) {
                _state.update {
                    it.copy(passcode = it.passcode.copy(busy = false, error = failure.message ?: "校验失败"))
                }
                return@launch
            }
            PasscodeStore(getApplication()).accept(sha, state.version)
            _state.update { it.copy(passcode = PasscodeState(version = state.version)) }
            syncAiConfig(sha, state.version)
        }
    }

    /** 口令通过后把服务端配置拉下来，本地就不用再手填 AI。 */
    private fun syncAiConfig(passcodeSha: String, version: Int) {
        if (passcodeSha.isBlank() || aiSyncedVersion == version) return
        viewModelScope.launch {
            val config = runCatching { BackendClient().aiConfig(passcodeSha) }.getOrNull() ?: return@launch
            if (config.baseUrl.isBlank() || config.model.isBlank()) return@launch
            val stored = runCatching {
                val provider = AiProvider.fromKey(config.provider)
                val app = getApplication<Application>()
                AiConfigStore(app).save(
                    AiConfig(provider = provider, baseUrl = config.baseUrl, model = config.model),
                    config.apiKey,
                )
                AiConfigStore(app).load()
            }.getOrNull() ?: return@launch
            aiSyncedVersion = version
            _state.update { it.copy(aiConfig = stored, aiStatus = "已从服务器同步 AI 配置") }
        }
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

    private fun summarize(json: String): String = runCatching {
        val root = JSONObject(json)
        val pkg = if (root.isNull("packageName")) "未知" else root.optString("packageName")
        val count = root.optJSONArray("elements")?.length() ?: 0
        val time = root.optLong("capturedAt")
        val formatted = Instant.ofEpochMilli(time)
            .atZone(ZoneId.systemDefault())
            .format(DateTimeFormatter.ofPattern("MM-dd HH:mm:ss"))
        "$pkg · $count 个控件 · $formatted"
    }.getOrDefault("已保存")
}
