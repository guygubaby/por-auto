package com.por.auto.agent.assistant

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Path
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import com.por.auto.agent.a11y.AgentAccessibilityService
import com.por.auto.agent.a11y.ScreenReader
import com.por.auto.agent.a11y.ScreenSnapshot
import com.por.auto.agent.a11y.UiElement
import com.por.auto.agent.ai.AiClient
import com.por.auto.agent.ai.AiConfig
import com.por.auto.agent.wecom.BroadcastGate
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

class AgentException(message: String) : Exception(message)

/**
 * 通用助手：读当前屏 → 问模型下一步 → 执行 → 再看一眼。
 * 只做看得见的动作，不猜坐标、不重放；任何一步说不清就停。
 */
class AgentRunner(
    private val service: AgentAccessibilityService,
    private val client: AiClient,
    private val config: AiConfig,
    private val key: String,
    private val log: (String) -> Unit,
) {

    suspend fun run(goal: String): String = BroadcastGate.withRun { execute(goal) }

    private suspend fun execute(goal: String): String {
        if (goal.isBlank()) throw AgentException("目标不能为空")
        val history = mutableListOf<String>()
        var stale = 0
        var repeats = 0
        var last = ""
        var step = 0

        // 不限步数，靠「界面没变化」和「重复同一个动作」两条护栏兜底，用户随时可以停。
        while (true) {
            currentCoroutineContext().ensureActive()
            val snapshot = ScreenReader.read(service)
            if (snapshot.protected) throw AgentException("当前屏幕有密码输入框，已停止")

            val action = AgentActionParser.parse(client.act(config, key, prompt(goal, snapshot, history)))
            when (action) {
                is AgentAction.Done -> {
                    log("完成：${action.summary}")
                    return action.summary
                }
                is AgentAction.Stop -> throw AgentException(action.reason)
                else -> Unit
            }

            val label = action.label()
            repeats = if (label == last) repeats + 1 else 0
            last = label
            if (repeats >= 3) throw AgentException("同一个动作重复 4 次没有进展，已停止")

            AgentGuard.blocked(targetName(snapshot, action), goal)?.let { throw AgentException(it) }
            step++
            log("$step. $label")
            perform(snapshot, action)
            history += label
            delay(action.delayAfter())

            val after = ScreenReader.read(service)
            stale = if (after.hash == snapshot.hash) stale + 1 else 0
            if (stale >= 2) throw AgentException("界面连续两步没有变化，已停止")
        }
    }

    private fun prompt(goal: String, snapshot: ScreenSnapshot, history: List<String>): String =
        buildString {
            append("目标：").append(goal).append("\n\n当前屏幕：\n")
            append(ScreenDigest.format(snapshot))
            if (history.isNotEmpty()) {
                append("\n已执行：\n")
                history.takeLast(6).forEach { append("- ").append(it).append('\n') }
            }
        }

    private fun targetName(snapshot: ScreenSnapshot, action: AgentAction): String =
        if (action is AgentAction.Tap) {
            snapshot.elements.getOrNull(action.index - 1)?.name.orEmpty()
        } else {
            ""
        }

    private suspend fun perform(snapshot: ScreenSnapshot, action: AgentAction) {
        when (action) {
            is AgentAction.Tap -> tap(clickable(snapshot, element(snapshot, action.index)))
            is AgentAction.Input -> {
                action.index?.let {
                    tap(clickable(snapshot, element(snapshot, it)))
                    delay(400)
                }
                if (!typeText(action.text)) throw AgentException("当前没有可输入的控件")
            }
            is AgentAction.Back -> if (!back()) throw AgentException("返回失败")
            is AgentAction.Scroll -> if (!scroll(action.forward)) throw AgentException("当前页面不能滚动")
            is AgentAction.Open -> if (!open(action.packageName)) {
                throw AgentException("打不开 ${action.packageName}")
            }
            is AgentAction.Wait -> Unit
            is AgentAction.Done, is AgentAction.Stop -> Unit
        }
    }

    private fun element(snapshot: ScreenSnapshot, index: Int): UiElement =
        snapshot.elements.getOrNull(index - 1) ?: throw AgentException("屏幕上没有第 $index 个控件")

    /** 文字节点自己不可点，用最近的可点击祖先。 */
    private fun clickable(snapshot: ScreenSnapshot, element: UiElement): UiElement {
        val ref = element.actionRef ?: return element
        return snapshot.elements.firstOrNull { it.ref == ref } ?: element
    }

    private suspend fun tap(element: UiElement) {
        val bounds = element.boundsPx
        if (!click((bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2)) {
            throw AgentException("点击没有完成")
        }
    }

    private suspend fun click(x: Int, y: Int): Boolean = suspendCancellableCoroutine { cont ->
        val path = Path().apply { moveTo(x.toFloat(), y.toFloat()) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 60))
            .build()
        val callback = object : AccessibilityService.GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription) {
                if (cont.isActive) cont.resume(true)
            }

            override fun onCancelled(gestureDescription: GestureDescription) {
                if (cont.isActive) cont.resume(false)
            }
        }
        val dispatched = service.dispatchGesture(gesture, callback, null)
        if (!dispatched && cont.isActive) cont.resume(false)
    }

    private fun back(): Boolean =
        service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)

    private fun scroll(forward: Boolean): Boolean {
        val node = findNode { it.isScrollable && it.isVisibleToUser } ?: return false
        val action = if (forward) {
            AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
        } else {
            AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
        }
        return node.performAction(action)
    }

    private fun typeText(text: String): Boolean {
        val focused = service.rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
        val node = focused?.takeIf { it.isEditable } ?: findNode { it.isEditable && it.isVisibleToUser }
        if (node == null) return false
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        }
        return node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
    }

    private fun open(packageName: String): Boolean {
        if (packageName.isBlank()) return false
        val intent = service.packageManager.getLaunchIntentForPackage(packageName) ?: return false
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return runCatching {
            service.startActivity(intent)
            true
        }.getOrDefault(false)
    }

    private fun findNode(predicate: (AccessibilityNodeInfo) -> Boolean): AccessibilityNodeInfo? {
        val root = service.rootInActiveWindow ?: return null
        return search(root, predicate, 0)
    }

    private fun search(
        node: AccessibilityNodeInfo,
        predicate: (AccessibilityNodeInfo) -> Boolean,
        depth: Int,
    ): AccessibilityNodeInfo? {
        if (depth > MAX_DEPTH) return null
        if (predicate(node)) return node
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            search(child, predicate, depth + 1)?.let { return it }
        }
        return null
    }

    private fun AgentAction.delayAfter(): Long = when (this) {
        is AgentAction.Wait -> ms
        is AgentAction.Open -> 1_500
        else -> 700
    }

    private companion object {
        const val MAX_DEPTH = 40
    }
}
