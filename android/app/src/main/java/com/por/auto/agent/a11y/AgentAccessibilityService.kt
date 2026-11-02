package com.por.auto.agent.a11y

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Intent
import android.view.accessibility.AccessibilityEvent
import com.por.auto.agent.capture.CaptureNotifier
import com.por.auto.agent.capture.CaptureRunner
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * P0 读屏服务：让 App 拿到当前屏的无障碍树，并提供一个悬浮「读屏」按钮。
 * 点击、输入、手势在 P1 再加。
 */
class AgentAccessibilityService : AccessibilityService() {

    private var overlay: OverlayHost? = null
    private var runStatus: RunStatusOverlay? = null

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        serviceInfo = serviceInfo?.apply {
            flags = flags or
                AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS or
                AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS or
                AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

    override fun onInterrupt() = Unit

    fun showOverlay() {
        val host = overlay ?: OverlayHost(this)
        host.show { captureFromOverlay() }
        overlay = host
    }

    fun hideOverlay() {
        overlay?.hide()
        overlay = null
    }

    val overlayVisible: Boolean get() = overlay != null

    /** 群发 / 定时跑动时的小状态条，不吃触摸。 */
    fun showRunStatus(text: String) {
        val current = runStatus ?: RunStatusOverlay(this).also { runStatus = it }
        current.show(text)
    }

    fun updateRunStatus(text: String) {
        runStatus?.update(text)
    }

    fun hideRunStatus() {
        runStatus?.hide()
        runStatus = null
    }

    private fun captureFromOverlay() {
        val appContext = applicationContext
        CoroutineScope(Dispatchers.IO).launch {
            CaptureNotifier(appContext).showResult(CaptureRunner.capture(appContext))
        }
    }

    override fun onUnbind(intent: Intent?): Boolean {
        hideOverlay()
        hideRunStatus()
        if (instance === this) instance = null
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        hideOverlay()
        hideRunStatus()
        if (instance === this) instance = null
        super.onDestroy()
    }

    companion object {
        @Volatile
        var instance: AgentAccessibilityService? = null
            private set

        val isRunning: Boolean get() = instance != null
    }
}
