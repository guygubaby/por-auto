package com.por.auto.agent.schedule

import com.por.auto.agent.wecom.WecomScope
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class ScheduleStoreTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private fun file() = File(temporary.root, "schedules.json")
    private fun store() = ScheduleStore(file())

    @Test
    fun separateStoresDoNotLoseConcurrentEdits() {
        val executor = Executors.newFixedThreadPool(2)
        val start = CountDownLatch(1)
        try {
            val writers = (0..1).map { writer ->
                executor.submit {
                    start.await()
                    repeat(10) { index ->
                        store().upsert(Schedule.create("hello", 9, 0).copy(id = "$writer-$index"))
                    }
                }
            }
            start.countDown()
            writers.forEach { it.get(10, TimeUnit.SECONDS) }
            assertEquals(20, store().all().size)
        } finally {
            executor.shutdownNow()
        }
    }

    @Test
    fun outcomePreservesPauseAndNextTimeAndCannotResurrectDeletion() {
        val schedule = Schedule.create("hello", 9, 0)
        store().upsert(schedule)
        store().update(schedule.id) { it.copy(enabled = false, nextAtMs = 123L) }
        store().update(schedule.id) { it.copy(lastStatus = "sent", lastRunAtMs = 456L) }
        val saved = requireNotNull(store().find(schedule.id))
        assertFalse(saved.enabled)
        assertEquals(123L, saved.nextAtMs)
        assertEquals("sent", saved.lastStatus)
        store().remove(schedule.id)
        assertNull(store().update(schedule.id) { it.copy(lastStatus = "sent") })
        assertTrue(store().all().isEmpty())
    }

    @Test
    fun dueAlarmIsClaimedOnceAndPausedOrFutureAlarmsAreIgnored() {
        val now = 1_793_587_200_000L
        val schedule = Schedule.create("hello", 9, 0).copy(nextAtMs = now - 1)
        store().upsert(schedule)
        assertEquals(schedule, store().claimDue(schedule.id, now))
        assertTrue(requireNotNull(store().find(schedule.id)).nextAtMs > now)
        assertNull(store().claimDue(schedule.id, now))
        store().upsert(schedule.copy(enabled = false))
        assertNull(store().claimDue(schedule.id, now))
        assertNull(store().claimDue("missing", now))
    }

    @Test
    fun scopeSurvivesRoundTrip() {
        WecomScope.entries.forEach { scope ->
            val schedule = Schedule.create("hello", 9, 0, scope)
            store().upsert(schedule)
            assertEquals(scope, store().find(schedule.id)?.scope)
            store().remove(schedule.id)
        }
    }

    @Test
    fun corruptDefinitionsAreNotSilentlyReplaced() {
        file().writeText("broken json")
        assertThrows(Exception::class.java) { store().upsert(Schedule.create("hello", 9, 0)) }
        assertEquals("broken json", file().readText())
    }

    @Test
    fun failedWriteKeepsLastSavedDefinition() {
        val schedule = Schedule.create("hello", 9, 0)
        store().upsert(schedule)
        File(temporary.root, "schedules.json.tmp").mkdir()
        assertThrows(IOException::class.java) { store().update(schedule.id) { it.copy(text = "changed") } }
        assertEquals(listOf(schedule), store().all())
    }
}
