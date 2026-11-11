package com.por.auto.agent.wecom

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WecomTitleTest {

    @Test
    fun exactTitleMatches() {
        assertTrue(WecomTitle.same("ajfjfjfh", "ajfjfjfh"))
    }

    @Test
    fun groupMemberSuffixMatches() {
        assertTrue(WecomTitle.same("ajfjfjfh(1)", "ajfjfjfh"))
        assertTrue(WecomTitle.same("项目群（12）", "项目群"))
    }

    @Test
    fun ellipsisNeverMatches() {
        assertFalse(WecomTitle.same("ajfj…", "ajfjfjfh"))
        assertFalse(WecomTitle.same("ajfj...", "ajfjfjfh"))
        assertFalse(WecomTitle.same("ajfj…", "ajfj…"))
    }

    @Test
    fun differentTitlesDoNotMatch() {
        assertFalse(WecomTitle.same("ajfjfjfh(1)", "ajfjfjfh2"))
        assertFalse(WecomTitle.same("张三", "张三丰"))
    }

    @Test
    fun whitespaceAndFullWidthAreNormalized() {
        assertTrue(WecomTitle.same("项 目 群", "项目群"))
        assertTrue(WecomTitle.same("项目群（3）", "项目群"))
    }
}
