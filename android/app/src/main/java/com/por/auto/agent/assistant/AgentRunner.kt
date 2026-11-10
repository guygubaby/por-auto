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
import kotlinx.coroutines.CancellationException
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
        var feedback: String? = null

        // 出问题先给模型纠正的机会，连续多次仍然没有进展才停。
        while (true) {
            currentCoroutineContext().ensureActive()
            if (step >= MAX_STEPS) {
                throw AgentException("已经走了 $MAX_STEPS 步还没有完成，先停下；可以把目标拆小一点再试")
            }

            val snapshot = ScreenReader.read(service)
            if (snapshot.protected) throw AgentException("当前屏幕有密码输入框，已停止")

            val action = askModel(goal, snapshot, history, feedback)
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
            if (repeats >= 3) {
                throw AgentException("同一个动作「$label」做了 3 次画面都没变，已停止")
            }

            AgentGuard.blocked(targetName(snapshot, action), goal)?.let { throw AgentException(it) }
            step++
            log("$step. $label")

            val failure = runCatching { perform(snapshot, action) }.exceptionOrNull()
            if (failure != null) {
                if (failure is CancellationException) throw failure
                // 动作没做成不是终点：把原因告诉模型，让它换个做法。
                log("   失败：${failure.message}")
                feedback = "刚才的「$label」没有执行成功：${failure.message}。换一种做法，不要原样重试。"
                history += "$label → 失败：${failure.message}"
                delay(600)
                continue
            }
            history += label

            delay(action.delayAfter())
            val after = ScreenReader.read(service)
            if (after.hash != snapshot.hash) {
                stale = 0
                feedback = null
                continue
            }
            // 动画和加载会误判，再等一会儿重读一次才算「没变化」。
            delay(800)
            if (ScreenReader.read(service).hash != snapshot.hash) {
                stale = 0
                feedback = null
                continue
            }
            stale++
            log("   画面没有变化")
            feedback = if (stale >= 2) {
                "最近 $stale 步都没有让画面变化。不要再重复同样的操作：换目标（滚动、返回、点别的入口），" +
                    "或者确认确实做不到后用 stop 说明。"
            } else {
                "刚才那一步没有让画面变化。确认点的是不是正确的目标，必要时先滚动或返回再试。"
            }
            if (stale >= MAX_STALE) {
                throw AgentException("连续 $MAX_STALE 步没有任何进展，已停止；最后停在：$label")
            }
        }
    }

    /** 模型回的不是动作就带着错误再问一次，最多三次。 */
    private suspend fun askModel(
        goal: String,
        snapshot: ScreenSnapshot,
        history: List<String>,
        feedback: String?,
    ): AgentAction {
        var correction = ""
        repeat(3) { attempt ->
            if (attempt > 0) delay(300)
            val reply = client.act(config, key, prompt(goal, snapshot, history, feedback, correction))
            val action = runCatching { AgentActionParser.parse(reply) }.getOrElse { error ->
                correction = "你上一次的回复不是可执行的动作（${error.message}）。只输出一个 JSON 动作。" +
                    "回复原文：${reply.take(200)}"
                null
            }
            if (action != null) return action
        }
        throw AgentException("模型连续三次没有给出可执行的动作：$correction")
    }

    private fun prompt(
        goal: String,
        snapshot: ScreenSnapshot,
        history: List<String>,
        feedback: String?,
        correction: String,
    ): String = buildString {
        append("目标：").append(goal).append("\n\n当前屏幕：\n")
        append(ScreenDigest.format(snapshot))
        if (history.isNotEmpty()) {
            append("\n已执行：\n")
            history.takeLast(8).forEach { append("- ").append(it).append('\n') }
        }
        feedback?.let { append("\n注意：").append(it).append('\n') }
        if (correction.isNotBlank()) append("\n纠正：").append(correction).append('\n')
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
        if (!node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) return false
        // 有的输入框会接受动作但没写进去；读得回来就核对，把差异交给模型换做法。
        if (node.refresh()) {
            val current = node.text?.toString()
            if (current != null && current != text) {
                throw AgentException("输入框里的内容没有变成「$text」，现在是「$current」")
            }
        }
        return true
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
        const val MAX_STEPS = 60
        const val MAX_STALE = 4
    }
}
