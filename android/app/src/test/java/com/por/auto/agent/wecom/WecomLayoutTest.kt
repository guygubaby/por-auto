package com.por.auto.agent.wecom

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WecomLayoutTest {

    @Test
    fun editorIsTheOnlyEditableField() {
        val nodes = listOf<LayoutNode>(
            node(0, text = "群聊"),
            node(1, editable = true),
            node(2, text = "发送"),
        )
        assertEquals(1, WecomLayout.editor(nodes, hint = null)?.index)
        // 两个输入框分不清，宁可返回 null 也不猜
        assertNull(WecomLayout.editor(nodes + node(3, editable = true), hint = null))
    }

    @Test
    fun knownVersionHintWinsOverStructure() {
        val nodes = listOf<LayoutNode>(
            node(0, editable = true),
            node(1, editable = true, id = "iu5"),
        )
        assertEquals(1, WecomLayout.editor(nodes, hint = "iu5")?.index)
    }

    @Test
    fun listIsTheLargestScrollable() {
        val nodes = listOf<LayoutNode>(
            node(0, scrollable = true, bounds = listOf(0, 100, 900, 2000)),
            node(1, scrollable = true, bounds = listOf(0, 100, 900, 1300)),
        )
        assertEquals(0, WecomLayout.list(nodes, hint = null)?.index)
    }

    @Test
    fun twoEquallyLargeScrollablesAreRejected() {
        val nodes = listOf<LayoutNode>(
            node(0, scrollable = true, bounds = listOf(0, 0, 900, 1000)),
            node(1, scrollable = true, bounds = listOf(0, 0, 900, 980)),
        )
        assertNull(WecomLayout.list(nodes, hint = null))
    }

    @Test
    fun filterLabelIsUniqueAndClickableThroughItsParent() {
        val nodes = listOf<LayoutNode>(
            node(0, text = "群聊", clickable = true),
            node(1, text = "搜索"),
        )
        val label = WecomLayout.label(nodes, "群聊", "全部") ?: error("missing label")
        assertEquals(0, label.index)
        assertNull(WecomLayout.label(nodes + node(2, text = "全部"), "群聊", "全部"))
    }

    @Test
    fun clickableAncestorWalksUp() {
        val nodes = listOf<LayoutNode>(
            node(0, clickable = true),
            node(1, parent = 0, text = "群聊"),
            node(2, parent = 1, text = "群"),
        )
        assertEquals(0, WecomLayout.clickableAncestor(nodes, nodes[2])?.index)
        assertNull(WecomLayout.clickableAncestor(listOf(node(3, clickable = false)), node(3, clickable = false)))
    }

    @Test
    fun chatTitleIsTheTopmostTextInTheTopBand() {
        val nodes = listOf<LayoutNode>(
            node(0, text = "ajfjfjfh(1)", bounds = listOf(300, 60, 800, 120)),
            node(1, text = "1", bounds = listOf(700, 900, 900, 960)),
            node(2, text = "对方正在输入", bounds = listOf(200, 1900, 700, 1950)),
        )
        assertEquals(0, WecomLayout.chatTitle(nodes, height = 2000)?.index)
        assertNull(WecomLayout.chatTitle(listOf(node(3, text = "只有正文", bounds = listOf(0, 800, 100, 860))), 2000))
    }

    @Test
    fun messageTabOnlyMatchesTheBottomBar() {
        val nodes = listOf<LayoutNode>(
            node(0, text = "消息", clickable = true, bounds = listOf(0, 1800, 200, 1900)),
            node(1, text = "消息", bounds = listOf(0, 100, 200, 150)),
        )
        assertEquals(0, WecomLayout.messageTab(nodes, height = 1920)?.index)
    }

    @Test
    fun rowTitlesTakeTheFirstTextInsideEachRow() {
        val nodes = listOf<LayoutNode>(
            node(0, scrollable = true, bounds = listOf(0, 0, 900, 1800)),
            node(1, parent = 0, clickable = true),
            node(2, parent = 1, text = "群 A"),
            node(3, parent = 1, text = "早上好"),
            node(4, parent = 0, clickable = true),
            node(5, parent = 4, text = "群 B"),
        )
        val titles = WecomLayout.rowTitles(nodes, nodes[0], hint = null).map { it.text }
        assertEquals(listOf("群 A", "群 B"), titles)
    }

    @Test
    fun rowTitlesPreferKnownIdsWhenPresent() {
        val nodes = listOf<LayoutNode>(
            node(0, scrollable = true, bounds = listOf(0, 0, 900, 1800)),
            node(1, parent = 0, clickable = true),
            node(2, parent = 1, text = "3", id = "badge"),
            node(3, parent = 1, text = "群 A", id = "ibi"),
        )
        assertEquals(listOf("群 A"), WecomLayout.rowTitles(nodes, nodes[0], hint = "ibi").map { it.text })
        // 没有 ID 提示时跳过纯数字角标
        assertEquals(listOf("群 A"), WecomLayout.rowTitles(nodes, nodes[0], hint = null).map { it.text })
    }

    @Test
    fun avatarsAreRightSideImages() {
        val nodes = listOf<LayoutNode>(
            node(0, role = "android.widget.ImageView", bounds = listOf(50, 100, 150, 200)),
            node(1, role = "android.widget.ImageView", bounds = listOf(800, 100, 900, 200)),
            node(2, role = "android.widget.TextView", bounds = listOf(800, 100, 900, 200)),
        )
        assertEquals(listOf(1), WecomLayout.avatars(nodes, width = 1000).map { it.index })
    }

    private fun node(
        index: Int,
        parent: Int = -1,
        id: String = "",
        text: String = "",
        role: String = "android.widget.TextView",
        bounds: List<Int> = listOf(0, 0, 100, 100),
        clickable: Boolean = false,
        editable: Boolean = false,
        scrollable: Boolean = false,
        visible: Boolean = true,
        enabled: Boolean = true,
        hint: Boolean = false,
    ): LayoutNode = Fake(index, parent, id, text, role, bounds, clickable, editable, scrollable, visible, enabled, hint)

    private class Fake(
        override val index: Int,
        override val parent: Int,
        override val id: String,
        override val text: String,
        override val role: String,
        override val bounds: List<Int>,
        override val clickable: Boolean,
        override val editable: Boolean,
        override val scrollable: Boolean,
        override val visible: Boolean,
        override val enabled: Boolean,
        override val hint: Boolean,
    ) : LayoutNode {
        override val position: Int? = null
        override val valid: Boolean get() = visible && enabled
        override val centerX: Int get() = (bounds[0] + bounds[2]) / 2
        override val centerY: Int get() = (bounds[1] + bounds[3]) / 2
    }
}
