package com.por.auto.agent.assistant

import com.por.auto.agent.a11y.ScreenSnapshot
import com.por.auto.agent.a11y.UiElement
import com.por.auto.agent.ai.AiException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class AssistantProtocolTest {

    @Test
    fun parsesEveryAction() {
        assertEquals(AgentAction.Tap(3), parse("""{"action":"tap","index":3}"""))
        assertEquals(AgentAction.LongPress(3), parse("""{"action":"long_press","index":3}"""))
        assertEquals(AgentAction.Input(5, "你好"), parse("""{"action":"input","index":5,"text":"你好"}"""))
        assertEquals(AgentAction.Input(null, "你好"), parse("""{"action":"input","text":"你好"}"""))
        assertEquals(AgentAction.Back, parse("""{"action":"back"}"""))
        assertEquals(AgentAction.Home, parse("""{"action":"home"}"""))
        assertEquals(AgentAction.Recents, parse("""{"action":"recents"}"""))
        assertEquals(AgentAction.Notifications, parse("""{"action":"notifications"}"""))
        assertEquals(AgentAction.Enter, parse("""{"action":"enter"}"""))
        assertEquals(AgentAction.Scroll(true), parse("""{"action":"scroll","direction":"down"}"""))
        assertEquals(AgentAction.Scroll(false), parse("""{"action":"scroll","direction":"up"}"""))
        assertEquals(
            AgentAction.Swipe(AgentAction.Direction.Up),
            parse("""{"action":"swipe","direction":"up"}"""),
        )
        assertEquals(
            AgentAction.Swipe(AgentAction.Direction.Left),
            parse("""{"action":"swipe","direction":"left"}"""),
        )
        assertEquals(AgentAction.Wait(10_000), parse("""{"action":"wait","ms":99999}"""))
        assertEquals(AgentAction.Open("微信"), parse("""{"action":"open","app":"微信"}"""))
        assertEquals(
            AgentAction.Open("com.tencent.wework"),
            parse("""{"action":"open","package":"com.tencent.wework"}"""),
        )
        assertEquals(AgentAction.Done("好了"), parse("```json\n{\"action\":\"done\",\"summary\":\"好了\"}\n```"))
        assertEquals(AgentAction.Stop("做不到"), parse("""{"action":"stop","reason":"做不到"}"""))
    }

    @Test
    fun rejectsRepliesWithoutAValidAction() {
        listOf(
            "我觉得应该点第一个",
            """{"action":"tap"}""",
            """{"action":"teleport"}""",
            """{"action":"open"}""",
            """{"action":""}""",
        ).forEach { reply ->
            assertThrows(reply, AiException::class.java) { parse(reply) }
        }
    }

    @Test
    fun riskyTargetsAreBlockedUnlessGoalSaysSo() {
        assertNull(AgentGuard.blocked("设置", "打开设置"))
        assertNotNull(AgentGuard.blocked("删除会话", "打开设置"))
        assertNull(AgentGuard.blocked("删除会话", "删除这个会话"))
        assertNull(AgentGuard.blocked("", "随便看看"))
    }

    @Test
    fun digestKeepsPasswordFieldsWithoutTheirValues() {
        val screen = screen(
            element(name = "设置", clickable = true),
            element(name = "请输入密码", editable = true, secret = true),
            element(name = "搜索", editable = true),
        )
        val text = ScreenDigest.format(screen)

        assertTrue(text.contains("[1] 设置"))
        // 密码框要留给模型定位，但读屏只给出 hint，内容不会进提示词。
        assertTrue(text.contains("[2] 请输入密码"))
        assertTrue(text.contains("密码"))
        assertTrue(text.contains("[3] 搜索"))
        assertTrue(text.contains("可输入"))
    }

    @Test
    fun digestMarksBlankScreen() {
        assertTrue(ScreenDigest.format(screen()).contains("没有可操作的控件"))
    }

    private fun parse(reply: String) = AgentActionParser.parse(reply)

    private fun element(
        name: String = "",
        role: String = "android.widget.TextView",
        clickable: Boolean = false,
        editable: Boolean = false,
        scrollable: Boolean = false,
        secret: Boolean = false,
    ) = UiElement(
        ref = "@e1",
        parentRef = null,
        actionRef = if (clickable) "@e1" else null,
        editRef = if (editable) "@e1" else null,
        depth = 1,
        windowIndex = 0,
        role = role,
        name = name,
        resourceId = null,
        bounds = listOf(0, 0, 500, 100),
        boundsPx = listOf(0, 0, 500, 100),
        clickable = clickable,
        editable = editable,
        scrollable = scrollable,
        hint = false,
        secret = secret,
        packageName = "com.example",
    )

    private fun screen(vararg elements: UiElement) = ScreenSnapshot(
        capturedAt = 0L,
        packageName = "com.example",
        width = 1080,
        height = 1920,
        windows = emptyList(),
        elements = elements.toList(),
        hash = 0L,
        protected = elements.any { it.secret },
    )
}
