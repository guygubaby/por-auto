package com.por.auto.agent.schedule

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDateTime
import java.time.ZoneId

class ScheduleTest {

    private val zone: ZoneId = ZoneId.of("Asia/Shanghai")

    private fun at(year: Int, month: Int, day: Int, hour: Int, minute: Int): Long =
        LocalDateTime.of(year, month, day, hour, minute).atZone(zone).toInstant().toEpochMilli()

    private fun next(hour: Int, minute: Int, nowMs: Long): LocalDateTime =
        LocalDateTime.ofInstant(
            java.time.Instant.ofEpochMilli(Schedule.nextOccurrence(hour, minute, nowMs, zone)),
            zone,
        )

    @Test
    fun laterTodayStaysToday() {
        val now = at(2026, 11, 1, 8, 0)
        assertEquals(LocalDateTime.of(2026, 11, 1, 9, 0), next(9, 0, now))
    }

    @Test
    fun earlierTodayRollsToTomorrow() {
        val now = at(2026, 11, 1, 10, 0)
        assertEquals(LocalDateTime.of(2026, 11, 2, 9, 0), next(9, 0, now))
    }

    @Test
    fun exactlyNowRollsToTomorrow() {
        val now = at(2026, 11, 1, 9, 0)
        assertEquals(LocalDateTime.of(2026, 11, 2, 9, 0), next(9, 0, now))
    }

    @Test
    fun daylightSavingGapIsComparedAsAnInstant() {
        val newYork = ZoneId.of("America/New_York")
        val now = LocalDateTime.of(2026, 3, 8, 3, 0).atZone(newYork).toInstant().toEpochMilli()
        val next = Schedule.nextOccurrence(2, 30, now, newYork)
        assertEquals(
            LocalDateTime.of(2026, 3, 8, 3, 30),
            LocalDateTime.ofInstant(java.time.Instant.ofEpochMilli(next), newYork),
        )
        assertTrue(next > now)
    }

    @Test
    fun nextOccurrenceIsAfterNow() {
        val now = System.currentTimeMillis()
        assertTrue(Schedule.nextOccurrence(0, 0, now) > now)
        assertTrue(Schedule.nextOccurrence(23, 59, now) > now)
    }
}
