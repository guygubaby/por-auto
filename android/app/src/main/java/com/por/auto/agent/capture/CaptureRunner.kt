package com.por.auto.agent.capture

import android.accessibilityservice.AccessibilityService
import android.content.Context
import com.por.auto.agent.a11y.AgentAccessibilityService
import com.por.auto.agent.a11y.ScreenReader
import com.por.auto.agent.a11y.ScreenSnapshot
import com.por.auto.agent.a11y.SnapshotJson
import kotlinx.coroutines.delay

/** 读屏、编码、落盘的共用逻辑：通知动作和悬浮按钮都走这里。 */
object CaptureRunner {

    suspend fun capture(context: Context): CaptureResult {
        val service = AgentAccessibilityService.instance ?: return CaptureResult.NoService
        return runCatching {
            val snapshot = readTarget(service)
            if (snapshot == null || snapshot.elements.isEmpty()) CaptureResult.NoWindow
            else save(context, snapshot)
        }.getOrElse {
            CaptureResult.Error(it.message ?: it.javaClass.simpleName)
        }
    }

    /**
     * 从通知栏点动作时通知栏还开着，直接读会读到 com.android.systemui。
     * 先等目标 App 的窗口回来；一直没回来就按一次返回收起通知栏（没有应用窗口时才按）。
     * 悬浮按钮不经过通知栏，通常会立即返回。
     */
    private suspend fun readTarget(service: AgentAccessibilityService): ScreenSnapshot? {
        var last: ScreenSnapshot? = null
        repeat(10) { attempt ->
            val snapshot = ScreenReader.read(service)
            last = snapshot
            val appWindow = snapshot.windows
                .filter { it.type == "application" && it.packageName != "com.android.systemui" }
                .maxByOrNull { it.nodeCount }
            if (appWindow != null && appWindow.nodeCount > 0) return snapshot
            if (attempt == 3) {
                service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            }
            delay(250)
        }
        return last
    }

    private fun save(context: Context, snapshot: ScreenSnapshot): CaptureResult {
        val json = SnapshotJson.encode(snapshot)
        val file = DumpStore(context).save(json)
        return CaptureResult.Success(snapshot, json, file)
    }
}
