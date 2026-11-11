package com.por.auto.agent.assistant

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Path
import android.os.Build
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
        val guard = StuckGuard()
        var step = 0
        var feedback: String? = null
        var budgetWarned = false

        // 出问题先给模型纠正的机会：提醒几次，换过做法仍然没有进展才停。
        while (true) {
            currentCoroutineContext().ensureActive()
            if (step >= MAX_STEPS) {
                throw AgentException(
                    "已经走了 $MAX_STEPS 步还没有完成，先停下；可以把目标拆小一点再试。最后一步：${history.lastOrNull().orEmpty()}",
                )
            }
            if (!budgetWarned && step >= MAX_STEPS * 3 / 4) {
                budgetWarned = true
                feedback = "已经走了 $step 步，接近 $MAX_STEPS 步上限。" +
                    "优先把已经拿到的结果用 done 交给用户；确实做不到再用 stop 说明卡在哪。"
            }

            val snapshot = ScreenReader.read(service)

            val action = askModel(goal, snapshot, history, feedback)
            when (action) {
                is AgentAction.Done -> {
                    log("完成：${action.summary}")
                    return action.summary
                }
                is AgentAction.Stop -> throw AgentException(action.reason)
                else -> Unit
            }

            val label = label(snapshot, action)
            when (val verdict = guard.action(label)) {
                is Verdict.Stop -> throw AgentException(verdict.reason)
                is Verdict.Nudge -> feedback = verdict.text
                Verdict.Ok -> Unit
            }

            AgentGuard.blocked(targetName(snapshot, action), goal)?.let { throw AgentException(it) }
            step++
            log("$step. $label")

            val failure = runCatching { perform(snapshot, action) }.exceptionOrNull()
            if (failure != null) {
                if (failure is CancellationException) throw failure
                // 动作没做成不是终点：把原因告诉模型，让它换个做法。
                val reason = failure.message ?: failure.javaClass.simpleName
                log("   失败：$reason")
                history += "$label → 失败：$reason"
                when (val verdict = guard.failure(reason)) {
                    is Verdict.Stop -> throw AgentException(verdict.reason)
                    is Verdict.Nudge -> feedback = verdict.text
                    Verdict.Ok -> feedback = "刚才的「$label」没有执行成功：$reason。换一种做法，不要原样重试。"
                }
                delay(600)
                continue
            }
            guard.success()
            history += label

            delay(action.delayAfter())
            val after = ScreenReader.read(service)
            if (after.hash != snapshot.hash) {
                guard.changed()
                feedback = null
                continue
            }
            // 动画和加载会误判，多等一会儿重读一次才算「没变化」。
            delay(1_200)
            if (ScreenReader.read(service).hash != snapshot.hash) {
                guard.changed()
                feedback = null
                continue
            }
            log("   画面没有变化")
            when (val verdict = guard.unchanged()) {
                is Verdict.Stop -> throw AgentException(verdict.reason)
                is Verdict.Nudge -> feedback = verdict.text
                Verdict.Ok -> feedback = "刚才那一步没有让画面变化。确认点的是不是正确的目标，必要时先滚动或返回再试。"
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

    /** 密码框里的内容不写进界面日志和执行记录。 */
    private fun label(snapshot: ScreenSnapshot, action: AgentAction): String =
        if (action is AgentAction.Input && secretInput(snapshot, action.index)) {
            "输入密码（已隐藏）"
        } else {
            action.label()
        }

    private fun secretInput(snapshot: ScreenSnapshot, index: Int?): Boolean {
        if (index != null) return snapshot.elements.getOrNull(index - 1)?.secret == true
        val focused = service.rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
        return focused?.isPassword == true
    }

    private fun targetName(snapshot: ScreenSnapshot, action: AgentAction): String {
        val index = when (action) {
            is AgentAction.Tap -> action.index
            is AgentAction.LongPress -> action.index
            else -> return ""
        }
        return snapshot.elements.getOrNull(index - 1)?.name.orEmpty()
    }

    private suspend fun perform(snapshot: ScreenSnapshot, action: AgentAction) {
        when (action) {
            is AgentAction.Tap -> tap(clickable(snapshot, element(snapshot, action.index)))
            is AgentAction.LongPress -> {
                val bounds = clickable(snapshot, element(snapshot, action.index)).boundsPx
                if (!longPress((bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2)) {
                    throw AgentException("长按没有完成")
                }
            }
            is AgentAction.Input -> {
                action.index?.let {
                    tap(clickable(snapshot, element(snapshot, it)))
                    delay(400)
                }
                if (!typeText(action.text)) throw AgentException("当前没有可输入的控件")
            }
            is AgentAction.Back -> if (!global(AccessibilityService.GLOBAL_ACTION_BACK)) {
                throw AgentException("返回失败")
            }
            is AgentAction.Home -> if (!global(AccessibilityService.GLOBAL_ACTION_HOME)) {
                throw AgentException("无法回到桌面")
            }
            is AgentAction.Recents -> if (!global(AccessibilityService.GLOBAL_ACTION_RECENTS)) {
                throw AgentException("打不开最近任务")
            }
            is AgentAction.Notifications -> if (!global(AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS)) {
                throw AgentException("打不开通知栏")
            }
            is AgentAction.Enter -> if (!enter()) {
                throw AgentException("当前没有可以按回车的输入框")
            }
            is AgentAction.Scroll -> {
                if (!scroll(action.forward)) throw AgentException("当前页面不能滚动，可以改用 swipe")
            }
            is AgentAction.Swipe -> if (!swipe(action.direction)) throw AgentException("滑动没有完成")
            is AgentAction.Open -> if (!open(action.app)) {
                throw AgentException("打不开 ${action.app}")
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

    private suspend fun click(x: Int, y: Int): Boolean =
        gesture(x.toFloat(), y.toFloat(), x.toFloat(), y.toFloat(), 60)

    private suspend fun longPress(x: Int, y: Int): Boolean =
        gesture(x.toFloat(), y.toFloat(), x.toFloat(), y.toFloat(), 650)

    private suspend fun swipe(direction: AgentAction.Direction): Boolean {
        val metrics = service.resources.displayMetrics
        val w = metrics.widthPixels.toFloat()
        val h = metrics.heightPixels.toFloat()
        val (sx, sy, ex, ey) = when (direction) {
            AgentAction.Direction.Up -> listOf(w / 2, h * 0.72f, w / 2, h * 0.28f)
            AgentAction.Direction.Down -> listOf(w / 2, h * 0.28f, w / 2, h * 0.72f)
            AgentAction.Direction.Left -> listOf(w * 0.82f, h / 2, w * 0.18f, h / 2)
            AgentAction.Direction.Right -> listOf(w * 0.18f, h / 2, w * 0.82f, h / 2)
        }
        return gesture(sx, sy, ex, ey, 300)
    }

    private suspend fun gesture(
        startX: Float,
        startY: Float,
        endX: Float,
        endY: Float,
        durationMs: Long,
    ): Boolean = suspendCancellableCoroutine { cont ->
        val path = Path().apply {
            moveTo(startX, startY)
            if (startX != endX || startY != endY) lineTo(endX, endY)
        }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, durationMs))
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

    private fun global(action: Int): Boolean = service.performGlobalAction(action)

    private fun enter(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return false
        val node = service.rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
            ?.takeIf { it.isEditable } ?: return false
        return node.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)
    }

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
        // 密码框回读只会拿到掩码，核对没有意义，还会把明文写进错误信息。
        if (node.isPassword) return true
        // 有的输入框会接受动作但没写进去；读得回来就核对，把差异交给模型换做法。
        if (node.refresh()) {
            val current = node.text?.toString()
            if (current != null && current != text) {
                throw AgentException("输入框里的内容没有变成「$text」，现在是「$current」")
            }
        }
        return true
    }

    /** app 可以是应用名（微信）或包名（com.tencent.mm）。 */
    private fun open(app: String): Boolean {
        val name = app.trim()
        if (name.isEmpty()) return false
        val manager = service.packageManager
        val apps = runCatching {
            manager.queryIntentActivities(
                Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER),
                0,
            ).mapNotNull { info ->
                val pkg = info.activityInfo?.packageName ?: return@mapNotNull null
                runCatching { info.loadLabel(manager).toString() }.getOrDefault(pkg) to pkg
            }
        }.getOrDefault(emptyList())
        val packageName = apps.firstOrNull { it.second == name }?.second
            ?: apps.firstOrNull { it.first.equals(name, ignoreCase = true) }?.second
            ?: apps.firstOrNull { it.first.contains(name, ignoreCase = true) }?.second
            ?: name.takeIf { it.contains('.') }
            ?: throw AgentException(
                "没有找到应用「$name」，可用的有：${apps.map { it.first }.distinct().take(20).joinToString("、")}",
            )
        val intent = manager.getLaunchIntentForPackage(packageName)
            ?: throw AgentException("「$name」没有可以打开的界面")
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
        is AgentAction.Home, is AgentAction.Recents, is AgentAction.Notifications -> 1_200
        is AgentAction.Enter -> 500
        else -> 700
    }

    private companion object {
        const val MAX_DEPTH = 40
        const val MAX_STEPS = 120
    }
}
