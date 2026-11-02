package com.por.auto.agent.wecom

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class WecomIdsTest {

    @Test
    fun knownVersionMapsControlIds() {
        val ids = WecomIds.forVersion("5.0.12")
        assertEquals("o6j", ids.messageTab)
        assertEquals("db5", ids.list)
        assertEquals("ibi", ids.rowTitle)
        assertEquals("fwr", ids.filterText)
        assertEquals("fws", ids.filterButton)
        assertEquals("iu5", ids.editor)
        assertEquals("ith", ids.messageBody)
        assertEquals("j3b", ids.avatar)
    }

    @Test
    fun unknownVersionIsRejected() {
        assertThrows(WecomException::class.java) { WecomIds.forVersion("5.0.99") }
        assertThrows(WecomException::class.java) { WecomIds.forVersion(null) }
    }

    @Test
    fun supportedVersionsAreListed() {
        assertTrue("5.0.12" in WecomIds.supportedVersions)
    }
}
