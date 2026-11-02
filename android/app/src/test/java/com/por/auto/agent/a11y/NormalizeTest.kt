package com.por.auto.agent.a11y

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class NormalizeTest {

    @Test
    fun boundsAreNormalizedAndClamped() {
        assertEquals(listOf(0, 0, 999, 999), Normalize.bounds(0, 0, 1080, 1920, 1080, 1920))
        assertEquals(listOf(0, 0, 499, 499), Normalize.bounds(-10, -10, 540, 960, 1080, 1920))
        assertEquals(listOf(0, 0, 0, 0), Normalize.bounds(0, 0, 10, 10, 0, 0))
    }

    @Test
    fun hashIsStableAndChangesWithInput() {
        val a = Normalize.fnv(Normalize.FNV_OFFSET, "发送")
        val b = Normalize.fnv(Normalize.FNV_OFFSET, "发送")
        val c = Normalize.fnv(Normalize.FNV_OFFSET, "发送1")
        assertEquals(a, b)
        assertNotEquals(a, c)
    }

    @Test
    fun keyUsesRoleNameAndBounds() {
        assertEquals("TextView|发送|0,0,100,100", Normalize.key("TextView", "发送", listOf(0, 0, 100, 100)))
    }
}
