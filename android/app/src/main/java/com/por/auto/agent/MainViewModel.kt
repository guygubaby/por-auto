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
import com.por.auto.agent.schedule.AlarmScheduler
import com.por.auto.agent.schedule.BroadcastService
import com.por.auto.agent.schedule.Schedule
import com.por.auto.agent.schedule.ScheduleStore
import com.por.auto.agent.wecom.BroadcastResult
import com.por.auto.agent.wecom.RecipientResult
import com.por.auto.agent.wecom.RunRecord
import com.por.auto.agent.wecom.RunStore
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
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

data class MainUiState(
    val accessibilityEnabled: Boolean = false,
    val overlayVisible: Boolean = false,
    val latestJson: String? = null,
    val latestSummary: String? = null,
    val message: String? = null,
    val p1Running: Boolean = false,
    val p1DryRunText: String? = null,
    val p1Log: List<String> = emptyList(),
    val p1Results: List<RecipientResult> = emptyList(),
    val schedules: List<Schedule> = emptyList(),
    val exactAlarmAllowed: Boolean = true,
    val runs: List<RunRecord> = emptyList(),
    val aiConfig: AiConfig = AiConfig(),
    val aiModels: List<String> = emptyList(),
    val aiBusy: Boolean = false,
    val aiStatus: String? = null,
    val aiDraft: String? = null,
)

class MainViewModel(application: Application) : AndroidViewModel(application) {

    private val _state = MutableStateFlow(MainUiState())
    val state: StateFlow<MainUiState> = _state.asStateFlow()

    fun refresh() {
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

    fun runBroadcast(dryRun: Boolean, text: String) {
        if (_state.value.p1Running) return
        val service = AgentAccessibilityService.instance
        if (service == null) {
            _state.update { it.copy(message = "无障碍服务未开启") }
            return
        }
        if (!dryRun && _state.value.p1DryRunText != text) {
            _state.update { it.copy(message = "消息已修改或还没试运行，请先试运行") }
            return
        }
        _state.update {
            it.copy(
                p1Running = true,
                p1DryRunText = null,
                p1Log = emptyList(),
                p1Results = emptyList(),
                message = if (dryRun) "试运行中…" else "发送中…",
            )
        }
        viewModelScope.launch(Dispatchers.IO) {
            val runner = WecomBroadcastRunner(service) { line ->
                _state.update { state -> state.copy(p1Log = (state.p1Log + line).takeLast(60)) }
            }
            val result = runCatching {
                runner.run(text, WecomScope.Groups, dryRun)
            }.getOrElse {
                if (it is CancellationException) throw it
                BroadcastResult(
                    dryRun = dryRun,
                    results = listOf(RecipientResult("—", WecomScope.Groups, "failed", it.message)),
                    error = it.message ?: it.javaClass.simpleName,
                )
            }
            runCatching { RunStore(getApplication()).save(result) }
            val runs = RunStore(getApplication()).history()
            _state.update {
                it.copy(
                    p1Running = false,
                    p1DryRunText = text.takeIf { result.rehearsed },
                    p1Results = result.results,
                    runs = runs,
                    message = when {
                        result.error != null -> "停止：${result.error}"
                        dryRun -> "试运行完成：${result.completed} 个"
                        else -> "发送完成：${result.completed} 个"
                    },
                )
            }
        }
    }

    fun addSchedule(text: String, hour: Int, minute: Int) {
        val validation = runCatching { WecomBroadcastRunner.validateText(text) }
        if (validation.isFailure) {
            _state.update { it.copy(message = validation.exceptionOrNull()?.message) }
            return
        }
        if (hour !in 0..23 || minute !in 0..59) {
            _state.update { it.copy(message = "时间无效，小时 0-23、分钟 0-59") }
            return
        }
        changeSchedules { store, scheduler ->
            val schedule = Schedule.create(text, hour, minute)
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
            val config = AiConfig(provider = provider, baseUrl = baseUrl.trim(), model = "", hasKey = true)
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
                AiClient().chat(config, store.keyFor(config.provider, config.baseUrl, ""), instruction)
            }.onFailure { if (it is CancellationException) throw it }
            _state.update {
                it.copy(
                    aiBusy = false,
                    aiStatus = result.fold(
                        onSuccess = { text -> "已生成，请检查后再试运行" },
                        onFailure = { error -> "生成失败：${error.message}" },
                    ),
                    aiDraft = result.getOrNull(),
                )
            }
        }
    }

    fun consumeAiDraft() {
        _state.update { it.copy(aiDraft = null) }
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
