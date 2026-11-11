package com.por.auto.agent.schedule

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BroadcastServiceTest {
    @Test
    fun androidEightDoesNotRequireANonexistentForegroundPermission() {
        assertNull(BroadcastService.foregroundPermission(26))
        assertNull(BroadcastService.foregroundPermission(27))
        assertEquals("android.permission.FOREGROUND_SERVICE", BroadcastService.foregroundPermission(28))
        assertEquals("android.permission.FOREGROUND_SERVICE", BroadcastService.foregroundPermission(33))
        assertEquals("android.permission.FOREGROUND_SERVICE_SPECIAL_USE", BroadcastService.foregroundPermission(34))
        assertEquals("android.permission.FOREGROUND_SERVICE_SPECIAL_USE", BroadcastService.foregroundPermission(35))
    }
}
