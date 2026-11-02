package com.por.auto.agent.wecom

import android.accessibilityservice.AccessibilityService
import android.app.KeyguardManager
import android.graphics.Rect
import android.os.PowerManager
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo

class WecomException(message: String) : Exception(message)
class StaleTreeException : Exception("页面控件尚未就绪")

/**
 * 企业微信当前聚焦窗口的完整无障碍树。和 P0 的 ScreenSnapshot 不同：
 * 这里保留空容器和原始节点，便于按资源 ID 找控件、沿父链找可点击行、执行原生动作。
 */
class WecomTree private constructor(
    val nodes: List<Node>,
    private val kept: List<AccessibilityNodeInfo>,
) : AutoCloseable {

    data class Node(
        override val index: Int,
        val native: AccessibilityNodeInfo,
        override val parent: Int,
        override val id: String,
        override val text: String,
        override val role: String,
        override val hint: Boolean,
        override val bounds: List<Int>,
        override val visible: Boolean,
        override val enabled: Boolean,
        override val editable: Boolean,
        val password: Boolean,
        override val clickable: Boolean,
        override val scrollable: Boolean,
        override val position: Int?,
    ) : LayoutNode {
        override val valid: Boolean
            get() = visible && enabled && bounds.size == 4 &&
                bounds[2] > bounds[0] && bounds[3] > bounds[1]

        override val centerX: Int get() = (bounds[0] + bounds[2]) / 2
        override val centerY: Int get() = (bounds[1] + bounds[3]) / 2
    }

    fun node(index: Int): Node = nodes.getOrElse(index) { throw WecomException("控件已变化") }

    fun one(id: String): Node {
        val found = nodes.filter { it.id == id && it.valid }
        if (found.size != 1) throw WecomException("无法唯一确认企业微信控件：$id")
        return found.single()
    }

    fun all(id: String): List<Node> = nodes.filter { it.id == id && it.valid }

    fun firstText(text: String): Node? = nodes.firstOrNull { it.text == text && it.valid }

    fun texts(text: String): List<Node> = nodes.filter { it.text == text && it.valid }

    fun under(node: Node, ancestor: Node): Boolean {
        var parent = node.parent
        while (parent >= 0) {
            if (parent == ancestor.index) return true
            parent = nodes[parent].parent
        }
        return false
    }

    /** 从 [node] 沿父链上溯，直到它的父节点是 [list]；找不到返回 null。 */
    fun rowOf(node: Node, list: Node): Node? {
        var current = node
        while (current.parent >= 0 && current.parent != list.index) {
            current = nodes[current.parent]
        }
        return current.takeIf { it.parent == list.index }
    }

    override fun close() {
        kept.forEach { node ->
            @Suppress("DEPRECATION")
            runCatching { node.recycle() }
        }
    }

    companion object {
        const val PACKAGE = "com.tencent.wework"
        private const val MAX_NODES = 4000

        fun read(service: AccessibilityService): WecomTree {
            requireUnlocked(service)
            val kept = mutableListOf<AccessibilityNodeInfo>()
            val nodes = mutableListOf<Node>()
            val root = focusedRoot(service) ?: throw WecomException("企业微信不在前台")
            try {
                return readFrom(root, kept, nodes)
            } catch (t: Throwable) {
                kept.forEach { node ->
                    @Suppress("DEPRECATION")
                    runCatching { node.recycle() }
                }
                throw t
            }
        }

        private fun readFrom(
            root: AccessibilityNodeInfo,
            kept: MutableList<AccessibilityNodeInfo>,
            nodes: MutableList<Node>,
        ): WecomTree {
            kept += root
            if (root.packageName?.toString() != PACKAGE) {
                throw WecomException("前台窗口不是企业微信")
            }

            val queue = ArrayDeque<Pair<AccessibilityNodeInfo, Int>>()
            queue.add(root to -1)
            var index = 0
            while (queue.isNotEmpty()) {
                if (index >= MAX_NODES) throw WecomException("企业微信控件数量超过读取限制")
                val (node, parent) = queue.removeFirst()
                if (!runCatching { node.refresh() }.getOrDefault(false)) throw StaleTreeException()

                val rect = Rect()
                node.getBoundsInScreen(rect)
                val item = node.collectionItemInfo
                nodes += Node(
                    index = index,
                    native = node,
                    parent = parent,
                    id = node.viewIdResourceName?.removePrefix("$PACKAGE:id/").orEmpty(),
                    text = node.text?.toString().orEmpty(),
                    role = node.className?.toString().orEmpty(),
                    hint = node.isShowingHintText,
                    bounds = listOf(rect.left, rect.top, rect.right, rect.bottom),
                    visible = node.isVisibleToUser,
                    enabled = node.isEnabled,
                    editable = node.isEditable,
                    password = node.isPassword,
                    clickable = node.isClickable,
                    scrollable = node.isScrollable,
                    position = item?.rowIndex?.takeIf { it >= 0 },
                )

                for (i in 0 until node.childCount) {
                    val child = node.getChild(i) ?: throw StaleTreeException()
                    kept += child
                    queue.add(child to index)
                }
                index++
            }

            // 版本映射之外的安全兜底：任何位置出现这个词都直接停。
            if (nodes.any { it.text == "安全保护中" }) {
                throw WecomException("企业微信要求账号本人完成验证")
            }
            if (nodes.isEmpty() || nodes.none { it.id.isNotEmpty() || it.text.isNotEmpty() || it.editable }) {
                throw StaleTreeException()
            }
            return WecomTree(nodes, kept)
        }

        private fun focusedRoot(service: AccessibilityService): AccessibilityNodeInfo? {
            for (window in service.windows.orEmpty()) {
                if (!window.isFocused || window.type != AccessibilityWindowInfo.TYPE_APPLICATION) continue
                val root = runCatching { window.root }.getOrNull() ?: continue
                if (root.packageName?.toString() == PACKAGE) return root
                @Suppress("DEPRECATION")
                root.recycle()
            }
            return null
        }

        fun requireUnlocked(service: AccessibilityService) {
            if (service.getSystemService(KeyguardManager::class.java)?.isKeyguardLocked == true ||
                service.getSystemService(PowerManager::class.java)?.isInteractive == false
            ) {
                throw WecomException("手机已锁屏或息屏，停止运行")
            }
        }
    }
}
