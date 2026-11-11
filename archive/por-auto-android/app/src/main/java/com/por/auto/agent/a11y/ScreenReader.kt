package com.por.auto.agent.a11y

import android.accessibilityservice.AccessibilityService
import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo

/**
 * 把无障碍窗口树归一化成 UiElement 列表。
 * P0 只读当前屏；不点击、不输入、不截图。
 */
object ScreenReader {
    private const val MIN_SIZE = 5
    private const val MAX_DEPTH = 80

    fun read(service: AccessibilityService): ScreenSnapshot {
        val metrics = service.resources.displayMetrics
        val width = metrics.widthPixels
        val height = metrics.heightPixels
        val windows = service.windows.orEmpty()

        val state = State(width, height)
        val windowInfos = mutableListOf<UiWindow>()

        windows.forEachIndexed { index, window ->
            val root = runCatching { window.root }.getOrNull()
            val windowPackage = root?.packageName?.toString()
            val before = state.elements.size
            // 自己的状态条是给用户看的：不进控件清单，否则它的文字一变，
            // 助手就会误以为界面变了，模型也会读到「1. 点击 [3]」这种运行日志。
            val ownOverlay = window.type == AccessibilityWindowInfo.TYPE_ACCESSIBILITY_OVERLAY &&
                windowPackage == service.packageName
            if (root != null) {
                try {
                    if (!ownOverlay) visit(root, 0, null, null, null, index, windowPackage, state)
                } finally {
                    @Suppress("DEPRECATION")
                    root.recycle()
                }
            }
            windowInfos += UiWindow(
                index = index,
                type = windowType(window.type),
                layer = window.layer,
                title = window.title?.toString(),
                packageName = windowPackage,
                focused = window.isFocused,
                active = window.isActive,
                nodeCount = state.elements.size - before,
            )
        }

        // 应用窗口可能不止一个（系统弹窗、GMS 浮层）。取控件最多的那个作为本次读屏的目标 App，
        // 避免读到只有 0 个控件的临时窗口。
        val topPackage = windowInfos
            .filter { it.type == "application" }
            .maxByOrNull { it.nodeCount }
            ?.packageName
            ?: windowInfos.firstOrNull { it.packageName != null }?.packageName

        return ScreenSnapshot(
            capturedAt = System.currentTimeMillis(),
            packageName = topPackage,
            width = width,
            height = height,
            windows = windowInfos,
            elements = state.elements,
            hash = state.hash,
            protected = state.protected,
        )
    }

    private class State(val width: Int, val height: Int) {
        val elements = mutableListOf<UiElement>()
        val seen = HashSet<String>()
        var hash = Normalize.FNV_OFFSET
        var protected = false
    }

    private fun visit(
        node: AccessibilityNodeInfo,
        depth: Int,
        parentRef: String?,
        actionRef: String?,
        editRef: String?,
        windowIndex: Int,
        windowPackage: String?,
        state: State,
    ) {
        if (depth > MAX_DEPTH) return

        var addedRef: String? = null
        if (node.isVisibleToUser) {
            val rect = Rect()
            node.getBoundsInScreen(rect)
            val role = node.className?.toString().orEmpty()
            val secret = node.isPassword
            val hintText = node.hintText?.toString()?.trim().orEmpty()
            val text = node.text?.toString()?.trim().orEmpty()
            val description = node.contentDescription?.toString()?.trim().orEmpty()
            val name = when {
                secret -> hintText
                text.isNotEmpty() -> text
                description.isNotEmpty() -> description
                else -> ""
            }
            val interactive = node.isClickable || node.isEditable || node.isScrollable

            if (rect.width() >= MIN_SIZE && rect.height() >= MIN_SIZE && (name.isNotEmpty() || interactive)) {
                val boundsPx = listOf(rect.left, rect.top, rect.right, rect.bottom)
                if (state.seen.add(Normalize.key(role, name, boundsPx))) {
                    val ref = "@e${state.elements.size + 1}"
                    state.elements += UiElement(
                        ref = ref,
                        parentRef = parentRef,
                        actionRef = if (node.isClickable) ref else actionRef,
                        editRef = if (node.isEditable) ref else editRef,
                        depth = depth,
                        windowIndex = windowIndex,
                        role = role,
                        name = name,
                        resourceId = node.viewIdResourceName,
                        bounds = Normalize.bounds(rect.left, rect.top, rect.right, rect.bottom, state.width, state.height),
                        boundsPx = boundsPx,
                        clickable = node.isClickable,
                        editable = node.isEditable,
                        scrollable = node.isScrollable,
                        hint = node.isShowingHintText,
                        secret = secret,
                        packageName = windowPackage,
                    )
                    addedRef = ref
                    state.hash = Normalize.fnv(state.hash, role)
                    state.hash = Normalize.fnv(state.hash, name)
                    state.hash = Normalize.fnv(state.hash, node.viewIdResourceName)
                    state.hash = Normalize.fnv(state.hash, boundsPx.joinToString(","))
                    if (secret) state.protected = true
                }
            }
        }

        val childParent = addedRef ?: parentRef
        val childActionRef = if (node.isClickable) addedRef ?: actionRef else actionRef
        val childEditRef = if (node.isEditable) addedRef ?: editRef else editRef
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            try {
                visit(child, depth + 1, childParent, childActionRef, childEditRef, windowIndex, windowPackage, state)
            } finally {
                @Suppress("DEPRECATION")
                child.recycle()
            }
        }
    }

    private fun windowType(type: Int): String = when (type) {
        AccessibilityWindowInfo.TYPE_APPLICATION -> "application"
        AccessibilityWindowInfo.TYPE_INPUT_METHOD -> "input_method"
        AccessibilityWindowInfo.TYPE_SYSTEM -> "system"
        AccessibilityWindowInfo.TYPE_ACCESSIBILITY_OVERLAY -> "accessibility_overlay"
        AccessibilityWindowInfo.TYPE_SPLIT_SCREEN_DIVIDER -> "split_screen_divider"
        else -> "type_$type"
    }
}
