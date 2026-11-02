package com.por.auto.agent.a11y

import android.annotation.SuppressLint
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.TextView
import kotlin.math.abs

/**
 * 无障碍服务自己的悬浮按钮（TYPE_ACCESSIBILITY_OVERLAY），不需要「显示在其他应用上层」权限。
 * 可拖动：按住移动，松手不触发读屏；原地轻点才读屏。
 */
class OverlayHost(private val service: AgentAccessibilityService) {

    private val windowManager = service.getSystemService(WindowManager::class.java)
    private var view: View? = null

    // TextView inherits View.performClick; taps delegate to it and its click listener.
    @SuppressLint("ClickableViewAccessibility")
    fun show(onCapture: () -> Unit) {
        if (view != null) return
        val button = TextView(service).apply {
            text = "读屏"
            setTextColor(Color.WHITE)
            textSize = 14f
            gravity = Gravity.CENTER
            minimumWidth = (48 * resources.displayMetrics.density).toInt()
            minimumHeight = minimumWidth
            setOnClickListener { onCapture() }
            setPadding(36, 18, 36, 18)
            background = GradientDrawable().apply {
                cornerRadius = 999f
                setColor(Color.parseColor("#1F6FEB"))
            }
        }
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.END
            x = 24
            y = 400
        }

        val touchSlop = ViewConfiguration.get(service).scaledTouchSlop
        val metrics = service.resources.displayMetrics
        var downX = 0f
        var downY = 0f
        var startX = 0
        var startY = 0
        var moved = false

        button.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = event.rawX
                    downY = event.rawY
                    startX = params.x
                    startY = params.y
                    moved = false
                    true
                }

                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - downX
                    val dy = event.rawY - downY
                    if (!moved && (abs(dx) > touchSlop || abs(dy) > touchSlop)) moved = true
                    if (moved) {
                        val maxX = (metrics.widthPixels - button.width).coerceAtLeast(0)
                        val maxY = (metrics.heightPixels - button.height).coerceAtLeast(0)
                        params.x = (startX - dx.toInt()).coerceIn(0, maxX)
                        params.y = (startY + dy.toInt()).coerceIn(0, maxY)
                        windowManager.updateViewLayout(button, params)
                    }
                    true
                }

                MotionEvent.ACTION_UP -> {
                    if (!moved) button.performClick()
                    true
                }

                else -> false
            }
        }

        windowManager.addView(button, params)
        view = button
    }

    fun hide() {
        view?.let { runCatching { windowManager.removeView(it) } }
        view = null
    }
}
