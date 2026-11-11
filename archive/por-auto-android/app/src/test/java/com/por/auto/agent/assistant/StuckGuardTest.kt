package com.por.auto.agent.assistant

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class StuckGuardTest {

    @Test
    fun repeatedActionWarnsBeforeStopping() {
        val guard = StuckGuard()
        val verdicts = (1..12).map { guard.action("点击 [3]") }

        assertEquals(Verdict.Nudge::class.java, verdicts[2].javaClass)
        assertEquals(Verdict.Nudge::class.java, verdicts[5].javaClass)
        assertTrue(verdicts.take(11).none { it is Verdict.Stop })
        assertTrue(verdicts[11] is Verdict.Stop)
    }

    @Test
    fun unchangedScreenWarnsTwiceBeforeStopping() {
        val guard = StuckGuard()
        val verdicts = (1..12).map { guard.unchanged() }

        assertEquals(Verdict.Nudge::class.java, verdicts[2].javaClass)
        assertEquals(Verdict.Nudge::class.java, verdicts[5].javaClass)
        assertEquals(Verdict.Nudge::class.java, verdicts[8].javaClass)
        assertTrue(verdicts.take(11).none { it is Verdict.Stop })
        assertTrue(verdicts[11] is Verdict.Stop)
    }

    @Test
    fun failuresWarnTwiceBeforeStopping() {
        val guard = StuckGuard()
        val verdicts = (1..8).map { guard.failure("没有这个控件") }

        assertEquals(Verdict.Nudge::class.java, verdicts[1].javaClass)
        assertEquals(Verdict.Nudge::class.java, verdicts[3].javaClass)
        assertTrue(verdicts.take(7).none { it is Verdict.Stop })
        assertTrue(verdicts[7] is Verdict.Stop)
    }

    @Test
    fun switchingScreenResetsTheCounters() {
        val guard = StuckGuard()
        repeat(12) { guard.unchanged() }
        guard.changed()
        val verdicts = (1..6).map { guard.unchanged() }

        assertTrue(verdicts.none { it is Verdict.Stop })
        assertEquals(Verdict.Nudge::class.java, verdicts[2].javaClass)
    }
}
