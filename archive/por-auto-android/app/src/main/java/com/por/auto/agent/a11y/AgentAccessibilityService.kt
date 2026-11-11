package com.por.auto.agent.a11y

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Intent
import android.view.accessibility.AccessibilityEvent

/**
 * 读屏服务：给群发和助手提供无障碍树、点击与输入能力。
 */
class AgentAccessibilityService : AccessibilityService() {

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

    /**
     * 只看别的应用发来的界面事件，用来补读屏树看不到的变化（自绘控件、颜色变化等）。
     * 自己 App 的事件（包括运行状态条）不算。
     */
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val current = event ?: return
        if (current.packageName?.toString() == packageName) return
        when (current.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED,
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED,
            AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED,
            AccessibilityEvent.TYPE_VIEW_SCROLLED,
            AccessibilityEvent.TYPE_VIEW_CLICKED,
            AccessibilityEvent.TYPE_VIEW_SELECTED,
            -> contentEventCount++
        }
    }

    override fun onInterrupt() = Unit

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

    override fun onUnbind(intent: Intent?): Boolean {
        hideRunStatus()
        if (instance === this) instance = null
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
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

    /** 别的应用发来的界面事件总数；读屏树没变但它在涨，说明界面其实变了。 */
    @Volatile
    var contentEventCount: Long = 0L
        private set
}
