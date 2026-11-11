package com.por.auto.agent.wecom

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.graphics.Path
import android.os.Build
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

    /** 第二条点击通道：手势被系统吞掉时，改走控件的 ACTION_CLICK。 */
    fun clickNode(node: AccessibilityNodeInfo): Boolean {
        requireForeground()
        return node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
    }

    /** 把文字放进剪贴板并保留原内容；写入失败时 ok=false，调用方不得继续粘贴。 */
    fun setClipboard(text: String): ClipboardBackup {
        val clipboard = service.getSystemService(ClipboardManager::class.java)
            ?: return ClipboardBackup(null, false)
        val previous = runCatching { clipboard.primaryClip }.getOrNull()
        val ok = runCatching {
            clipboard.setPrimaryClip(ClipData.newPlainText("por-auto", text))
        }.isSuccess
        return ClipboardBackup(previous, ok)
    }

    fun restoreClipboard(backup: ClipboardBackup) {
        val clipboard = service.getSystemService(ClipboardManager::class.java) ?: return
        runCatching {
            if (backup.clip != null) {
                clipboard.setPrimaryClip(backup.clip)
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                clipboard.clearPrimaryClip()
            } else {
                // API 26–27 没有 clearPrimaryClip：至少把消息正文从剪贴板换掉。
                clipboard.setPrimaryClip(ClipData.newPlainText("", ""))
            }
        }
    }

    /** 粘贴到输入框；ACTION_PASTE 不保证成功，调用方必须回读草稿。 */
    fun paste(node: AccessibilityNodeInfo): Boolean {
        requireForeground()
        if (!node.refresh() || !node.isEditable) return false
        node.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
        return node.performAction(AccessibilityNodeInfo.ACTION_PASTE)
    }

    data class ClipboardBackup(val clip: ClipData?, val ok: Boolean)

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
