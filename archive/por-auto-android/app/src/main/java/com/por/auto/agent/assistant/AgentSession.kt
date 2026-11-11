package com.por.auto.agent.assistant

import android.app.Application
import com.por.auto.agent.a11y.AgentAccessibilityService
import com.por.auto.agent.ai.AiClient
import com.por.auto.agent.ai.AiConfigStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * 助手跑在应用级作用域里，配一个前台服务：界面被销毁或退到后台也不会中断。
 * 对话状态放在这里，Activity 重建后还能接着看。
 */
object AgentSession {

    private val _turns = MutableStateFlow<List<AgentTurn>>(emptyList())
    val turns: StateFlow<List<AgentTurn>> = _turns.asStateFlow()

    private val _running = MutableStateFlow(false)
    val running: StateFlow<Boolean> = _running.asStateFlow()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var job: Job? = null

    /** 开始一轮；返回给用户看的错误，成功返回 null。 */
    fun start(app: Application, goal: String): String? {
        if (_running.value) return "助手正在执行，先停止再开始"
        val service = AgentAccessibilityService.instance ?: return "无障碍服务未开启"
        val store = AiConfigStore(app)
        val config = store.load()
        if (!config.ready) return "请先在设置里配置 AI"
        val text = goal.trim()
        if (text.isEmpty()) return "先说一句要做什么"

        val index = _turns.value.size
        _turns.value = _turns.value + AgentTurn(goal = text, running = true)
        _running.value = true
        AgentService.start(app)
        service.showRunStatus("助手执行中…")

        job = scope.launch {
            val runner = AgentRunner(
                service = service,
                client = AiClient(),
                config = config,
                key = store.keyFor(config.provider, config.baseUrl, ""),
                log = { line ->
                    service.updateRunStatus(line)
                    update(index) { it.copy(steps = (it.steps + line).takeLast(60)) }
                },
            )
            val result = runCatching { runner.run(text) }
            service.hideRunStatus()
            update(index) { turn ->
                turn.copy(
                    running = false,
                    failed = result.isFailure,
                    result = result.fold(
                        onSuccess = { summary -> "完成：$summary" },
                        onFailure = { error ->
                            if (error is CancellationException) "已停止" else "停止：${error.message}"
                        },
                    ),
                )
            }
            _running.value = false
            job = null
            AgentService.stop(app)
        }
        return null
    }

    fun stop(app: Application) {
        job?.cancel()
        job = null
        AgentAccessibilityService.instance?.hideRunStatus()
        _turns.value = _turns.value.map { turn ->
            if (turn.running) turn.copy(running = false, failed = true, result = "已停止") else turn
        }
        _running.value = false
        AgentService.stop(app)
    }

    /** 清空对话记录，开始新会话；执行中不允许清空。 */
    fun clear() {
        if (_running.value) return
        _turns.value = emptyList()
    }

    private fun update(index: Int, change: (AgentTurn) -> AgentTurn) {
        _turns.value = _turns.value.mapIndexed { i, turn -> if (i == index) change(turn) else turn }
    }
}
