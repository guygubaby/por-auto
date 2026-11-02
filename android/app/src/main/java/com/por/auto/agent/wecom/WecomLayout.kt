package com.por.auto.agent.wecom

/** 定位只需要这些字段；单测里用假节点，不碰无障碍 API。 */
internal interface LayoutNode {
    val index: Int
    val parent: Int
    val id: String
    val text: String
    val role: String
    val bounds: List<Int>
    val visible: Boolean
    val enabled: Boolean
    val hint: Boolean
    val editable: Boolean
    val clickable: Boolean
    val scrollable: Boolean
    val position: Int?
    val valid: Boolean
    val centerX: Int
    val centerY: Int
}

/**
 * 按界面结构定位企微控件。资源 ID 只是已知版本上的提示，未知版本照样按结构走；
 * 每个 finder 都要求唯一，分不清就返回 null 让调用方停下，绝不猜。
 */
internal object WecomLayout {

    fun editor(nodes: List<LayoutNode>, hint: String?): LayoutNode? =
        hinted(nodes, hint) { it.editable }
            ?: nodes.singleOrNull { it.valid && it.editable }

    fun list(nodes: List<LayoutNode>, hint: String?): LayoutNode? {
        hinted(nodes, hint) { it.scrollable }?.let { return it }
        val scrollables = nodes.filter { it.valid && it.scrollable }.sortedByDescending(::area)
        val top = scrollables.firstOrNull() ?: return null
        val second = scrollables.getOrNull(1)
        // 两个差不多大的滚动区说明认不出主列表
        if (second != null && area(second) * 5 > area(top) * 4) return null
        return top
    }

    fun label(nodes: List<LayoutNode>, vararg texts: String): LayoutNode? =
        nodes.singleOrNull { it.valid && it.text in texts }

    fun clickableAncestor(nodes: List<LayoutNode>, node: LayoutNode): LayoutNode? {
        var current: LayoutNode? = node
        repeat(6) {
            val candidate = current ?: return null
            if (candidate.clickable) return candidate
            current = parentOf(nodes, candidate)
        }
        return null
    }

    /** 会话页标题：页面顶部区域里最靠上的那段文字。 */
    fun chatTitle(nodes: List<LayoutNode>, height: Int): LayoutNode? {
        val limit = height / 6
        return nodes.filter { it.valid && it.text.isNotBlank() && it.bounds[3] <= limit }
            .minByOrNull { it.bounds[1] }
    }

    /** 底部「消息」导航。 */
    fun messageTab(nodes: List<LayoutNode>, height: Int): LayoutNode? =
        nodes.filter { it.valid && it.text == "消息" && it.bounds[1] > height * 3 / 4 }
            .singleOrNull()
            ?.let { clickableAncestor(nodes, it) }

    /** 列表里每一行的标题：行内第一个有文字的节点；已知版本优先用 ID。 */
    fun rowTitles(nodes: List<LayoutNode>, list: LayoutNode, hint: String?): List<LayoutNode> {
        val titled = hint?.let { id ->
            nodes.filter { it.valid && it.id == id && isUnder(nodes, it, list) }
        }.orEmpty()
        if (titled.isNotEmpty()) return titled
        return nodes.filter { it.parent == list.index && it.valid }
            .mapNotNull { row ->
                val texts = nodes.filter { it.valid && it.text.isNotBlank() && isUnder(nodes, it, row) }
                // 行首常是未读角标（纯数字），优先取第一个非纯数字的文字
                texts.firstOrNull { text -> text.text.any { !it.isDigit() } }
                    ?: texts.minByOrNull { it.index }
            }
    }

    fun texts(nodes: List<LayoutNode>, text: String): List<LayoutNode> =
        nodes.filter { it.valid && it.text == text }

    fun avatars(nodes: List<LayoutNode>, width: Int): List<LayoutNode> =
        nodes.filter { it.valid && it.role.endsWith("ImageView") && it.centerX > width / 2 }

    fun isUnder(nodes: List<LayoutNode>, node: LayoutNode, ancestor: LayoutNode): Boolean {
        var parent = node.parent
        while (parent >= 0) {
            if (parent == ancestor.index) return true
            parent = nodes.getOrNull(parent)?.parent ?: return false
        }
        return false
    }

    fun parentOf(nodes: List<LayoutNode>, node: LayoutNode): LayoutNode? =
        nodes.getOrNull(node.parent)

    private fun hinted(
        nodes: List<LayoutNode>,
        hint: String?,
        check: (LayoutNode) -> Boolean,
    ): LayoutNode? = hint?.let { id -> nodes.singleOrNull { it.valid && it.id == id && check(it) } }

    private fun area(node: LayoutNode): Int =
        (node.bounds[2] - node.bounds[0]) * (node.bounds[3] - node.bounds[1])
}
