package com.por.auto.agent.wecom

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Path
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import com.por.auto.agent.a11y.AgentAccessibilityService
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/** P1 的前台动作：坐标点击、原生写文字、返回、启动企微。 */
class WecomActions(private val service: AgentAccessibilityService) {

    suspend fun click(x: Int, y: Int): Boolean = suspendCancellableCoroutine { cont ->
        requireForeground()
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

    fun setText(ids: WecomIds, title: String, expected: String, text: String): Boolean =
        WecomTree.read(service).use { tree ->
            if (!WecomTitle.same(tree.one(ids.messageTab).text, title)) {
                throw WecomException("写入前会话已变化")
            }
            val node = tree.one(ids.editor).native
            if (!node.refresh() || !node.isVisibleToUser || !node.isEnabled ||
                !node.isEditable || node.isPassword
            ) {
                throw WecomException("当前不是可核对的聊天输入框")
            }
            val current = if (node.isShowingHintText) "" else node.text?.toString().orEmpty()
            if (current != expected) throw WecomException("草稿已变化，未覆盖或清理")
            val args = Bundle().apply {
                putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
            }
            requireForeground()
            node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        }

    fun back(): Boolean {
        requireForeground()
        return service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
    }

    fun requireForeground() {
        WecomTree.requireUnlocked(service)
        if (focusedPackage() != WecomTree.PACKAGE) throw WecomException("企业微信不在前台")
    }

    fun launchWecom(): Boolean {
        val intent = service.packageManager.getLaunchIntentForPackage(WecomTree.PACKAGE) ?: return false
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return runCatching {
            service.startActivity(intent)
            true
        }.getOrDefault(false)
    }

    fun focusedPackage(): String? {
        for (window in service.windows.orEmpty()) {
            if (!window.isFocused || window.type != AccessibilityWindowInfo.TYPE_APPLICATION) continue
            val root = runCatching { window.root }.getOrNull() ?: continue
            val pkg = root.packageName?.toString()
            @Suppress("DEPRECATION")
            runCatching { root.recycle() }
            return pkg
        }
        return null
    }
}
