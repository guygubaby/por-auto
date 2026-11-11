package com.por.auto.agent.a11y

import android.annotation.SuppressLint
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView

/**
 * 群发 / 定时 / 助手跑到企微里时显示的小状态条：转圈 + 当前在做什么。
 * 不吃触摸（FLAG_NOT_TOUCHABLE），不会挡住脚本要点的地方；无障碍服务灭掉时跟着消失。
 */
class RunStatusOverlay(private val service: AgentAccessibilityService) {

    private val windowManager = service.getSystemService(WindowManager::class.java)
    // 调用方常在 IO 线程（日志回调），加窗口必须回主线程。
    private val main = Handler(Looper.getMainLooper())
    private var label: TextView? = null
    private var view: View? = null

    fun show(text: String) = main.post { showNow(text) }

    fun update(text: String) {
        main.post { label?.text = text }
    }

    fun hide() = main.post {
        val current = view ?: return@post
        runCatching { windowManager.removeView(current) }
            .onFailure { Log.e("RunStatusOverlay", "removeView failed", it) }
        view = null
        label = null
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun showNow(text: String) {
        if (view != null) {
            label?.text = text
            return
        }
        val density = service.resources.displayMetrics.density
        val textView = TextView(service).apply {
            this.text = text
            setTextColor(Color.WHITE)
            textSize = 13f
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            maxWidth = (service.resources.displayMetrics.widthPixels * 0.7f).toInt()
        }
        val spinner = ProgressBar(service, null, android.R.attr.progressBarStyleSmall).apply {
            indeterminateTintList = android.content.res.ColorStateList.valueOf(Color.WHITE)
        }
        val row = LinearLayout(service).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding((14 * density).toInt(), (8 * density).toInt(), (16 * density).toInt(), (8 * density).toInt())
            background = GradientDrawable().apply {
                cornerRadius = 999f
                setColor(Color.parseColor("#CC1C1915"))
            }
            addView(spinner, LinearLayout.LayoutParams((16 * density).toInt(), (16 * density).toInt()))
            addView(textView, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { marginStart = (8 * density).toInt() })
        }
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            y = (72 * density).toInt()
        }
        // 有些 ROM 不接受“不吃触摸”的悬浮窗，退一步允许它吃触摸，至少能看见。
        val loose = WindowManager.LayoutParams(
            params.width,
            params.height,
            params.type,
            params.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv(),
            params.format,
        ).apply {
            gravity = params.gravity
            x = params.x
            y = params.y
        }
        val added = runCatching { windowManager.addView(row, params) }.isSuccess ||
            runCatching { windowManager.addView(row, loose) }.isSuccess
        if (!added) Log.e("RunStatusOverlay", "addView failed")
        label = textView
        view = row
    }
}
