package com.por.auto.agent.assistant

import com.por.auto.agent.ai.AiException
import org.json.JSONObject

/** 助手每一步只做一个动作。index 是屏幕列表里的 1 基序号。 */
sealed interface AgentAction {
    data class Tap(val index: Int) : AgentAction
    data class LongPress(val index: Int) : AgentAction
    data class Input(val index: Int?, val text: String) : AgentAction
    data object Back : AgentAction
    data object Home : AgentAction
    data object Recents : AgentAction
    data object Notifications : AgentAction
    data object Enter : AgentAction
    data class Scroll(val forward: Boolean) : AgentAction
    data class Swipe(val direction: Direction) : AgentAction
    data class Wait(val ms: Long) : AgentAction
    data class Open(val app: String) : AgentAction
    data class Done(val summary: String) : AgentAction
    data class Stop(val reason: String) : AgentAction

    enum class Direction(val label: String) {
        Up("上"), Down("下"), Left("左"), Right("右");

        companion object {
            fun of(value: String): Direction = when (value.trim().lowercase()) {
                "up" -> Up
                "left" -> Left
                "right" -> Right
                else -> Down
            }
        }
    }

    /** 写进「已执行」列表的一行，模型靠它避免重复。 */
    fun label(): String = when (this) {
        is Tap -> "点击 [$index]"
        is LongPress -> "长按 [$index]"
        is Input -> "输入 ${text.take(20)}"
        Back -> "返回"
        Home -> "回到桌面"
        Recents -> "打开最近任务"
        Notifications -> "打开通知栏"
        Enter -> "按下回车"
        is Scroll -> if (forward) "向下滚动" else "向上滚动"
        is Swipe -> "向${direction.label}滑动"
        is Wait -> "等待 ${ms}ms"
        is Open -> "打开 $app"
        is Done -> "完成：$summary"
        is Stop -> "停止：$reason"
    }
}

object AgentActionParser {

    fun parse(reply: String): AgentAction {
        val start = reply.indexOf('{')
        val end = reply.lastIndexOf('}')
        if (start < 0 || end <= start) throw AiException("模型没有返回动作")
        val json = runCatching { JSONObject(reply.substring(start, end + 1)) }.getOrNull()
            ?: throw AiException("动作不是合法 JSON")
        return when (val name = json.optString("action").trim().lowercase()) {
            "tap" -> AgentAction.Tap(json.index())
            "long_press", "longpress" -> AgentAction.LongPress(json.index())
            "input", "type" -> AgentAction.Input(
                index = json.optInt("index", 0).takeIf { it > 0 },
                text = json.optString("text"),
            )
            "back" -> AgentAction.Back
            "home", "desktop" -> AgentAction.Home
            "recents" -> AgentAction.Recents
            "notifications" -> AgentAction.Notifications
            "enter" -> AgentAction.Enter
            "scroll" -> AgentAction.Scroll(forward = json.optString("direction") != "up")
            "swipe" -> AgentAction.Swipe(AgentAction.Direction.of(json.optString("direction")))
            "wait" -> AgentAction.Wait(json.optLong("ms", 800L).coerceIn(0L, 10_000L))
            "open" -> AgentAction.Open(
                json.optString("app").trim()
                    .ifBlank { json.optString("package").trim() }
                    .ifBlank { throw AiException("open 缺少 app") },
            )
            "done" -> AgentAction.Done(json.optString("summary").trim().ifBlank { "已完成" })
            "stop" -> AgentAction.Stop(json.optString("reason").trim().ifBlank { "模型主动停止" })
            else -> throw AiException("不认识的动作：${name.ifBlank { "空" }}")
        }
    }

    private fun JSONObject.index(): Int =
        optInt("index", 0).takeIf { it > 0 } ?: throw AiException("tap 缺少 index")
}
